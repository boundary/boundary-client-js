var bndry = bndry || {};
if (!console) { var console = { log: function () {} }; }

(function (bndry, $, undefined) {
  var uid = 0,
      activeDataSources = [];

  // set to true for handshake and subscription logging
  bndry.debug = false;

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
  
  // handles cometd connectivity with the streaming api
  var streakerClient = function () {
    var auth = bndry.auth,
        cometdEndpoint = auth.cometd,
        org_id = auth.org_id,
        apikey = auth.apikey,
        started = false;

    var subscriptions = {},
        unsubscriptions = {};

    $.cometd.configure(cometdEndpoint);

    $.cometd.addListener("/meta/handshake", function (message) {
      var i, len;

      if (message.successful) {
        if (bndry.debug) {
          console.log("handshake - " + message.clientId);
        }

        if (started) {
          // check for any pre-existing subscriptions (maybe we got disconnected and need to resubscribe)
          for (i = 0, len = activeDataSources.length; i < len; ++i) {
            activeDataSources[i].reconnect();
          }
        } else {
          started = true;
        }
      }
    });

    $.cometd.addListener("/meta/subscribe", function (message) {
      if (bndry.debug) {
        console.log("subscribed - " + message.subscription);
      }
    });

    $.cometd.addListener("/meta/unsubscribe", function (message) {
      var i, len;

      if (bndry.debug) {
        console.log("unsubscribed - " + message.subscription);
      }

      // look for any callbacks registered to run after we unsubscribed from this channel
      if (message.subscription && unsubscriptions[message.subscription]) {
        for (i = 0, len = unsubscriptions[message.subscription].length; i < len; ++i) {
          unsubscriptions[message.subscription][i]();
        }

        delete unsubscriptions[message.subscription];
      }
    });

    $.cometd.handshake({
      ext: {
        authentication: {},
        authentication_v2: {
          org_id: org_id,
          token: apikey
        }
      }
    });

    $.cometd.onListenerException = function(msg, query) {
      throw msg;
    };

    return {
      initialized: true,

      servertime: function () {
        return $.cometd.timesync.getServerTime();
      },

      subscribe: function (query, handler, options) {
        var subscription,
            id;

        query = options.subscriber == 'opaque' ? "/opaque/" + org_id + "/" + query : "/query/" + org_id + "/" + query;
        subscription = $.cometd.subscribe(query, handler);

        // NOTE: assuming cometd subscription object is an array that will return "query_name,integer" when toString is invoked
        // TODO: robustify this to work with things that might not be an array (generic objects?), or with array implementations that don't do this (old ass browsers?)
        id = subscription.toString();

        subscriptions[id] = {
          subscription: subscription,
          handler: handler,
          query: query
        };

        return id;
      },

      unsubscribe: function (id, callback) {
        if (subscriptions[id]) {
          if (callback) {
            if (!unsubscriptions[subscriptions[id].query]) {
              unsubscriptions[subscriptions[id].query] = [];
            }

            unsubscriptions[subscriptions[id].query].push(callback);
          }

          $.cometd.unsubscribe(subscriptions[id].subscription);
          delete subscriptions[id];
        }
      },

      isStarted: function () {
        return started;
      }
    };
  };

  // get a filtered/aggregated query channel to use with a datasource instance
  var requestFilteredQueryChannel = (function () {
    var id = 0,
        filterQueryRequests = {},
        initialized = false;

    function responder(response) {
      var data = response.data || {};

      if (data.result === 'success') {
        if (filterQueryRequests[data.id]) {
          // return the channel name to the callback assigned this id
          filterQueryRequests[data.id](data.location);
          delete filterQueryRequests[data.id];
        }
      } else {
        throw(new Error(data.message));
      }
    }

    /*
      filter = {
        name: filter name to apply to the query (currently only 'filter_by_meters'),
        values: list of key:value pairs to pass to the filter service
      }
    */
    return function (query, filter, callback) {
      var msg = { ext: {} },
          o;

      // we have to make sure the handshake has happened before we do anything
      if (!initialized) {
        if (!streakerClient.initialized) {
          streakerClient = streakerClient();
        } else if (streakerClient.isStarted()) {
          $.cometd.addListener('/service/queries', responder);
          initialized = true;
        }
      }

      if (initialized) {
        msg.ext.query = query;
        msg.ext.id = (id++).toString();
        for (o in filter.values) {
          if (o !== 'id' && o !== 'query') {
            msg.ext[o] = filter.values[o];
          }
        }

        filterQueryRequests[msg.ext.id] = callback;

        $.cometd.publish('/service/queries/' + filter.name, msg);
      } else {
        // streakerClient wasn't ready, so retry in a moment
        window.setTimeout(function () {
          requestFilteredQueryName(query, filter, callback);
        }, 100);
      }
    };
  })();

  /*
     options = {
       forceConnect: force a datasource to recieve updates, even if it has no subscribers,
       subscriber: only used for annotations, pass 'opaque'
     }

     filter = {
       name: name of filter the channel on /service/queries (ie, 'filter_by_meters'),
       values: list of key:value pairs to pass to the filter service
     }
  */
  var dataSource = function (query, options, filter) {
    if (!streakerClient.initialized) {
      streakerClient = streakerClient();
    }

    var subscribers = {},     // subscribers to this data source
        subscriberCount = 0,  // number of subscribers to this data source
        streakerID = null,    // string representation of subscription object
        lastData = {},        // most recent data update from streaker (includes full state)
        restarting = false,   // lock used when waiting for a full reconnect to streaker
        ds;                   // stores the interface for this instance

    // constants
    var WAITING = -1;

    // stores the overall state of all updates based on inserts and removes
    var state = (function () {
      var current = {};

      function isEmpty(obj) {
        var empty = true,
            t;

        for (t in obj) {
          empty = false;
          break;
        }

        return empty;
      }

      return {
        // returns null if current winds up being empty
        update: function (added, removed) {
          var i, len;

          for (i = 0, len = removed ? removed.length : 0; i < len; ++i) {
            delete current[removed[i].__key__];
          };

          for (i = 0, len = added ? added.length : 0; i < len; ++i) {
            current[added[i].__key__] = added[i];
          }

          return isEmpty(current) ? null : current;
        },

        get: function () {
          return isEmpty(current) ? null : current;
        },

        clear: function () {
          current = {};
        }
      };
    })();

    var expandData = (function () {
      var schema, // holds a mapping of array offsets to field names; use this to expand compressed objects before emitting to consumers
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
          if (data.insert && data.insert.length) {
            added = expand(data.insert);
          }

          if (data.remove && data.remove.length) {
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

      if (!restarting) {
        data.state = state.update(data.added, data.removed);

        // only update subscribers if we aren't restarting AND have state changes
        if (data.state) {

          window.setTimeout(function () {
            for (s in subscribers) {
              try {
                updateSubscriber(subscribers[s], data);
              } catch (e) {
                throw(e);
              }
            }
          }, 0);

          lastData = data;
        }
      }
    }

    // update because we got new data from streaker
    function streakerUpdate(msg) {
      update(expandData(msg));
    }

    // connects to streaker, with optional completion callback
    function connect(complete) {
      function finish(query) {
        state.clear();
        lastData = {};

        streakerID = streakerClient.subscribe(query, streakerUpdate, options || {});

        if (complete) {
          complete();
        }
      }

      if (!streakerID || streakerID === WAITING) {
        if (streakerClient.isStarted()) {
          if (filter) {
            streakerID = WAITING;
            requestFilteredQueryChannel(query, filter, finish);
          } else {
            finish(query);
          }
        } else {
          streakerID = WAITING;
          window.setTimeout(function () {
            connect(complete);
          }, 100);
        }
      }
    }

    // disconnect from streaker, with optional completion callback
    function disconnect(complete) {
      if (streakerID) {
        if (streakerID === WAITING) {
          window.setTimeout(function () {
            disconnect(complete);
          }, 100);
        } else {
          streakerClient.unsubscribe(streakerID, complete);
          streakerID = null;

          state.clear();
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
    ds = {
      addSubscriber: function (subscriber, transformation) {
        // connect if we haven't already
        if (!streakerID) {
          connect();
        }

        // update the subscriber list with the new info
        // TODO: remove support for passing in objects with an update method
        subscribers[++uid] = {
          update: subscriber,
          transform: (transformation && typeof transformation === 'function') ? transformation : null
        };

        subscriberCount++;

        if ('state' in lastData) {
          updateSubscriber(subscribers[uid], lastData);
        }

        // return the id of this subscription
        return uid;
      },

      removeSubscriber: function (id) {
        if (subscribers[id]) {
          delete subscribers[id];
          --subscriberCount;

          // see if we want to disconnect from streaker
          if (subscriberCount === 0 && options.forceConnect !== true) {
            disconnect();
          }
        }
      },

      // update a data transformation function for a subscription (pass null to remove transformation)
      updateTransformation: function (id, transformation) {
        if (subscribers[id]) {
          subscribers[id].transform = (transformation && typeof transformation === 'function' ? transformation : null);

          // run an immediate update for this subscriber using the last update from streaker
          if ('state' in lastData) {
            udpateSubscriber(subscribers[id], lastData);
          }
        }
      },

      reconnect: function () {
        if (streakerID) {
          restarting = true;

          disconnect(function () {
            connect(function () {
              restarting = false;
            });
          });
        }
      },

      updateFilter: function (updatedFilter) {
        filter = updatedFilter;
        this.reconnect();
      },

      lastUpdate: function () {
        return lastData;
      },

      sc: function () { return subscriberCount; }
    };

    // store this interface in case streaker needs to reconnect us at some point
    activeDataSources.push(ds);

    return ds;
  };

  // expose public-facing functionality
  bndry.dataSource = dataSource;
  bndry.dataSource.create = dataSource;

  // not sure why anyone would need this, but here you go
  bndry.dataSource.requestFilteredQueryChannel = requestFilteredQueryChannel;

})(bndry, jQuery);
