var bndry = bndry || {};
if (!console) { var console = { log: function () {} }; }

(function (bndry, $, undefined) {
  var uid = 0;

  // set to true for handshake and subscription logging
  bndry.debug = true;

  if (!bndry.auth) {
    throw new Error('Boundary auth credentials not defined');
    return;
  }

  // struct utility
  bndry.utils = bndry.utils || {};
  bndry.utils.struct = bndry.utils.struct || {
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
  
  // handles communication with streaming API
  var streakerClient = (function () {
    var auth = bndry.auth,
        cometdEndpoint = auth.cometd,
        org_id = auth.org_id,
        user = auth.user,
        apikey = auth.apikey,
        started = false;

    var subscriptions = {},
        uid = 0,
        id;

    $.cometd.configure(cometdEndpoint);

    $.cometd.addListener("/meta/handshake", function (message) {
      if (message.successful) {
        if (bndry.debug) {
          console.log("handshake - " + message.clientId);
        }

        started = true;

        // check for any pre-existing subscriptions (maybe we got disconnected and need to resubscribe)
        for (id in subscriptions) {
          $.cometd.unsubscribe(subscriptions[id].subscription);
          subscriptions[id].subscription = $.cometd.subscribe(subscriptions[id].query, subscriptions[id].handler);
        }
      }
    });

    $.cometd.addListener("/meta/subscribe", function (message) {
      if (bndry.debug) {
        console.log("subscribed - " + message.subscription);
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
        var subscription;

        query = options.subscriber == 'opaque' ?
          "/opaque/" + org_id + "/" + query :
          "/query/" + org_id + "/" + query;
        subscription = $.cometd.subscribe(query, handler);

        subscriptions[++uid] = {
          subscription: subscription,
          handler: handler,
          query: query
        };

        return uid;
      },
      
      unsubscribe: function (id) {
        $.cometd.unsubscribe(subscriptions[id].subscription);
        delete subscriptions[id];
      },
      
      isStarted: function () {
        return started;
      }
    };
  })();

  var dataSource = function (query, options) {
    var subscribers = {},
        subscriberCount = 0,
        streakerID = null,
        lastData = {};

    // constants
    var WAITING = -1;

    // stores the overall state of all updates based on inserts and removes
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
      var schema, // holds a mapping of array offsets to field names
          keys;   // list of field names that make up unique key

      function expand(source) {
        var out = [];

        out = bndry.utils.struct.unpack({
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

    // notify a subscriber of new data
    function updateSubscriber(subscriber, data) {
      if (subscriber.transform) {
        subscriber.transform(data, subscriber.update);
      } else {
        subscriber.update(data);
      }
    }

    // loop through subscribers and notify them of new data
    function update(data) {
      var s;

      if (options.updateInterval || data.added || data.removed) {
        data.state = state.update(data.added, data.removed);

        for (s in subscribers) {
          try {
            updateSubscriber(subscribers[s], data);
          } catch (e) {
            throw(e);
          }
        }

        lastData = data;
      }
    }

    // update because we got new data from streaker
    function streakerUpdate(msg) {
      update(expandData(msg));
    }

    // update every options.updateInterval milliseconds, regardless of updates from streaker
    var intervalUpdate = (function () {
      var timer,
          updates = {};

      return function (msg) {
        var data = expandData(msg),
            d;

        // until the timer triggers, cache any updates locally
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
          }, options.updateInterval);
        }
      };
    })();

    function connect() {
      if (streakerID === null || streakerID === WAITING) {
        if (streakerClient.isStarted()) {
          streakerID = streakerClient.subscribe(query,
                                                options.updateInterval ?
                                                intervalUpdate : streakerUpdate, options || {});
        } else {
          streakerID = WAITING;
          window.setTimeout(connect, 100);
        }
      }
    }

    function disconnect() {
      if (streakerID !== null) {
        if (streakerID === WAITING) {
          window.setTimeout(disconnect, 100);
        } else {
          streakerClient.unsubscribe(streakerID);

          streakerID = null;
          lastData = {};
        }
      }
    }

    // initialize instance
    options = options || {};
    if (options.forceConnect === true) {
      connect();
    }

    // instance interface
    return {
      addSubscriber: function (subscriber, transformation) {
        // make sure "this" is bound to the subscriber's instance, in case that matters to the subscriber
        function bind(o, f) {
          return function (data) {
            f.call(o, data);
          };
        }

        // connect if we haven't already
        if (!streakerID) {
          connect();
        }

        // update the subscriber list with the new info
        subscribers[++uid] = {
          update: bind(subscriber, subscriber.update),
          transform: (transformation && typeof transformation === 'function' ? transformation : null)
        };
        
        subscriberCount++;

        // return the id of this subscription
        return uid;
      },

      removeSubscriber: function (id) {
        delete subscribers[id];
        --subscriberCount;

        // see if we want to disconnect from streaker
        if (subscriberCount === 0 && !options.forceConnect) {
          disconnect();
        }
      },

      // update a data transformation function for a subscription (pass null to remove transformation)
      updateTransformation: function (id, transformation) {
        if (subscribers[id]) {
          subscribers[id].transform = (transformation &&
                                       typeof transformation === 'function' ? transformation : null);

          // run an immediate update for this subscriber using the last update from streaker
          udpateSubscriber(subscribers[id], lastData);
        }
      },

      lastUpdate: function () {
        return lastData;
      }
    };
  };

  // expose public-facing functionality
  bndry.dataSource = dataSource;
  bndry.dataSource.create = dataSource;

})(bndry, jQuery);


