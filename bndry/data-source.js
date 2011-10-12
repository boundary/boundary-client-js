var bndry = bndry || {};
if (!console) { var console = { log: function () {} }; }

(function (bndry, $, undefined) {
  var uid = 0;

  if (!bndry.auth) {
    throw new Error('Auth credentials not defined');
    return;
  }

  var struct = {
    pack: function (objects) {
      var schema = [], // holds the schema to include in the compressed output
          data = [],   // holds a list of all compressed data elements encoded using schema
          key,
          object,
          element,
          o, oLen,     // iterators
          s, sLen;

      if (objects.length > 0) {
        for (key in objects[0]) {
          if (objects[0].hasOwnProperty(key)) {
            schema.push(key);
          }
        }

        for (o = 0, oLen = objects.length; o < oLen; o++) {
          object = objects[o];
          element = [];

          for (s = 0, sLen = schema.length; s < sLen; s++) {
            // get the name of this schema element
            key = schema[s];
            element[s] = object[key];
          }

          data.push(element);
        }
      }

      return {
        schema: schema,
        data: data
      };

    },

    unpack: function (payload) {
      var schema,
          keys,
          data,
          objects,
          object,
          element,
          key,
          d, dLen,
          s, sLen,
          tmp;

      if (payload.constructor == Array) {
        // nothing to do here
        return payload;
      }

      schema = payload.schema;
      keys = payload.keys ? payload.keys : [];
      data = payload.data;
      objects = [];

      // cache schema length for use in inner loop
      sLen = schema.length;

      for (d = 0, dLen = data.length; d < dLen; d++) {
        element = data[d];
        object = {};
        object.__key__ = null; // pre-allocate this so it is ordered first

        for (s = 0; s < sLen; s++) {
          key = schema[s];
          object[key] = element[s];
        }

        tmp = [];
        for (key in keys) {
          tmp.push(object[keys[key]]);
        }

        object.__key__ = tmp.join(":");
        objects.push(object);
      }

      return objects;
    }
  };

  var streakerClient = (function () {
    var auth = bndry.auth,
        cometdEndpoint = auth.cometd,
        org_id = auth.org_id,
        user = auth.user,
        apikey = auth.apikey,

        started = false;

    $.cometd.configure(cometdEndpoint);

    $.cometd.addListener("/meta/subscribe", function (message) {
      console.log("subscribed");
    });

    $.cometd.addListener("/meta/handshake", function (message) {
      if (message.successful) {
        console.log("handshake - " + message.clientId);
        started = true;
      }
    });

    $.cometd.handshake({
      ext: {
        authentication: {
          user: user,
          token: apikey
        }
      }
    });

    $.cometd.onListenerException = function(msg, query) {
      throw msg;
    };

    return {
      servertime: function () {
        return $.cometd.timesync.getServerTime();
      },
      subscribe: function (query, handler, options) {
        query = options.subscriber == 'opaque' ? "/opaque/" + org_id + "/" + query : "/query/" + org_id + "/" + query;
        return $.cometd.subscribe(query, handler);
      },
      unsubscribe: function (subscription) {
        $.cometd.unsubscribe(subscription);
      },
      isStarted: function () {
        return started;
      }
    };
  })();

  var dataSource = function (query, updateInterval, options) {
    var subscribers = {},
        subscriberCount = 0,
        streakerID = null,
        lastData = null;

    // constants
    var WAITING = -1;

    var state = (function () {
      var current = {};

      return {
        get: function () { return current; },
        
        update: function (added, removed) {
          var i, len;

          for (i = 0, len = removed ? removed.length : 0; i < len; ++i) {
            delete current[removed[i].__key__];
          }
          
          for (i = 0, len = added ? added.length : 0; i < len; ++i) {
            current[added[i].__key__] = added[i];
          };

          return current;
        }
      };
    })();

    var expandData = (function () {
      var schema, // holds a mapping of array offsets to field names; use this to expand compressed objects before emitting to consumers
          keys;   // list of field names that make up unique key

      function expand(source) {
        var out = [];

        out = struct.unpack({
          schema: schema,
          keys: keys,
          data: source
        });

        return out;
      };

      return function (msg) {
        var data = msg.data,
            added = null,
            removed = null;

        if (data.schema) {
          schema = data.schema;
        }

        if (data.keys) {
          keys = data.keys;
        }

        if (schema) {
          if (data.insert) {
            added = expand(data.insert);
          }

          if (data.remove) {
            removed = expand(data.remove);
          }
        }

        return {
          added: added,
          removed: removed
        };
      };
    })();

    function update(data) {
      var subscriber, s;

      function postUpdate(s) {
        return function (data) {
          s.update(data);
        };
      }

      if (updateInterval || data.added || data.removed) {
        data.state = state.update(data.added, data.removed);

        for (s in subscribers) {
          subscriber = subscribers[s];

          // see if this subscriber requested the data be processed in a specific way
          if (subscriber.dataProcessor && typeof subscriber.dataProcessor === 'function') {
            subscriber.dataProcessor(data, postUpdate(subscriber));
          } else {
            postUpdate(subscriber)(data);
          }
        }

        lastData = data;
      }
    }

    function streakerUpdate(msg) {
      var data = expandData(msg);

      update(data);
    }

    var intervalUpdate = (function () {
      var timer,
          updates = {};
      
      return function (msg) {
        var data = expandData(msg),
            d;

        for (d in data) {
          if (!updates[d]) {
            updates[d] = data[d];
          } else if (data[d]) {
            updates[d] = updates[d].concat(data[d]);
          }
        }

        if (!timer) {
          timer = window.setInterval(function () {
            update(updates);
            updates = {};
          }, updateInterval);
        }
      };
    })();

    function connect() {
      if (!streakerID || streakerID === WAITING) {
        if (streakerClient.isStarted()) {
          streakerID = streakerClient.subscribe(query, updateInterval ? intervalUpdate : streakerUpdate, options || {});
        } else {
          streakerID = WAITING;
          window.setTimeout(connect, 100);
        }
      }
    }

    function disconnect() {
      if (streakerID) {
        if (streakerID === WAITING) {
          window.setTimeout(disconnect, 100);
        } else {
          streakerClient.unsubscribe(streakerID);
          streakerID = null;
        }
      }
    }

    return {
      addSubscriber: function (subscriber) {
        if (!streakerID) {
          connect();
        }

        subscribers[++uid] = subscriber;
        subscriberCount++;

        return uid;
      },

      removeSubscriber: function (id) {
        delete subscribers[id];
        --subscriberCount;

        if (subscriberCount === 0) {
          disconnect();
        }
      },

      lastUpdate: function () {
        return lastData || {};
      }
    };
  };

  // expose public-facing functionality
  bndry.dataSource = dataSource;
  bndry.dataSource.create = dataSource;

})(bndry, jQuery);
