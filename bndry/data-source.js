var bndry = bndry || {};
if (!console) { var console = { log: function () {} }; }

(function (bndry, $, undefined) {
  "use strict";
  
  var uid = 0,
      activeDataSources = [],
      transientFilterIDs = {};

  // set to true for handshake and subscription logging
  bndry.debug = false;

  // struct utility (defined in utils.js but included here as well for easier maintenance of the client-facing repo)
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

      if (payload.constructor === Array) {
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
          if (keys.hasOwnProperty(key)) {
            tmp.push(object[keys[key]]);
          }
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
          // reset any cached transient fp ids, in case those have timed out between handshakes
          requestFilteredQueryChannel.clearCache();

          // check for any pre-existing subscriptions (maybe we got disconnected and need to resubscribe)
          for (i = 0, len = activeDataSources.length; i < len; ++i) {
            activeDataSources[i].reconnect(true);
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

        query = options.subscriber === 'opaque' ? "/opaque/" + org_id + "/" + query : "/query/" + org_id + "/" + query;
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


  // generate a unique, consistent MD5 value from a transient flow profile filter, regardless of field orderings;
  //   used to cache requests to generate transient flow profile IDs
  var filterObjectToMD5 = (function () {
    var sorter = {
      meters: undefined,  // default sort is fine
      country: undefined, // default sort is fine
      transport: function (a, b) {
        var order = 0;

        // order first by port, then by protocol
        if (a.port < b.port) {
          order = -1;
        } else if (a.port === b.port) {
          if (a.protocol < b.protocol) {
            order = -1;
          } else if (a.protocol > b.protocol) {
            order = 1;
          }
        } else {
          order = 1;
        }

        return order;
      }
    };

    var process = {
      meters: function (o) { return o.sort(sorter.meters); },
      country: function (o) { return o.sort(sorter.country); },
      transport: function (o) {
        var values = o.sort(sorter.transport),
            ordered = [],
            i;

        for (i = 0; i < values.length; ++i) {
          ordered.push('port');
          ordered.push(o[i].port);
          ordered.push('protocol');
          ordered.push(o[i].protocol);
        }

        return ordered;
      },
      _default: function (o) {
        if (o.sort && typeof o.sort === 'function') {
          o.sort();
        }

        return o;
      }
    };

    // { meters: [4, 7], transport: [{ port: 4740, protocol: 6 }], country: ['US', 'CA'] } ==>
    //   ['meters', [4, 7], 'transport', ['port', 4720, 'protocol', 6], 'country', ['US', 'CA']]
    return function (obj) {
      var keys = [], key,
          fields = [],
          i;

      // get all filter keys in sorted order
      for (key in obj) {
        if (obj.hasOwnProperty(key)) {
          keys.push(key);
        }
      }
      keys.sort();

      // now create an array of [key, processedValue, key, processedValue ...] ordered pairs
      for (i = 0; i < keys.length; ++i) {
        key = keys[i];

        fields.push(key);
        fields.push((process[key] || process._default)(obj[key]));
      }

      return bndry.utils.md5(JSON.stringify(fields));
    };
  })();

  // get a meter-aggregated query channel to use with a datasource instance
  var requestAggregatedQueryChannel = (function () {
    var id = 0,
        aggregateQueryRequests = {},
        initialized = false;

    function responder(response) {
      var data = response.data || {};

      if (data.result === 'success') {
        if (aggregateQueryRequests[data.id]) {
          // return the channel name to the callback assigned this id
          aggregateQueryRequests[data.id](data.location);
          delete aggregateQueryRequests[data.id];
        }
      } else {
        throw(new Error(data.message));
      }
    }

    return function (query, meters, callback) {
      var msg = { ext: {} };

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
        msg.ext.observation_domain_ids = meters;

        aggregateQueryRequests[msg.ext.id] = callback;

        $.cometd.publish('/service/queries/filter_by_meters', msg);
      } else {
        // streakerClient wasn't ready, so retry in a moment
        window.setTimeout(function () {
          requestAggregatedQueryChannel(query, meters, callback);
        }, 100);
      }
    };
  })();

  // get a set of filtered channels for a given set of meters
  var requestFilteredQueryChannel = (function () {
    var filterQueryRequests = {},
        filterCache = {},
        initialized = false;

    function responder(response) {
      var data = response.data || {},
          request;

      if (data.result === true) {
        if (filterQueryRequests[data.request_id]) {
          // cache this transient ID for future requests using the same filter object
          //   (request_id === the hash of the filter object)
          filterCache[data.request_id] = {
            query: 'fp-' + data.id,
            subscribers: 0
          };

          // loop over all the callback requests waiting for this transient flow profile id
          while (filterQueryRequests[data.request_id].length) {
            request = filterQueryRequests[data.request_id].pop();
            request.callback('fp-' + data.id + '_' + request.query);
            filterCache[data.request_id].subscribers++;
          }

          delete filterQueryRequests[data.request_id];
        }
      } else {
        throw(new Error(data.message));
      }
    }

    var api = function (query, filter, callback) {
      var filterHash = filterObjectToMD5(filter),
          msg = { ext: { flow_profile: {} } },
          o;

      // see if we already requested this; if so, just append the id and return
      //   (lol this next line rhymes)
      if (filterCache[filterHash]) {
        callback(filterCache[filterHash].query + '_' + query);
        filterCache[filterHash].subscribers++;
        return;
      }

      // we have to make sure the handshake has happened before we do anything
      if (!initialized) {
        if (!streakerClient.initialized) {
          streakerClient = streakerClient();
        } else if (streakerClient.isStarted()) {
          $.cometd.addListener('/service/flow_profiles', responder);
          initialized = true;
        }
      }

      if (initialized) {
        // see if we already have a request in the pipeline for this transient filter
        if (filterQueryRequests[filterHash]) {
          filterQueryRequests[filterHash].push({
            query: query,
            callback: callback
          });

        // this is the first request for this particular filter, so publish a request
        } else {
          msg.ext.request_id = filterHash;
          msg.ext.flow_profile.name = '' + filterHash;
          msg.ext.flow_profile.filter = {};
          for (o in filter) {
            if (filter.hasOwnProperty(o)) {
              msg.ext.flow_profile.filter[o] = filter[o];
            }
          }

          // store the query and callback for use when we get a response from cometd
          filterQueryRequests[filterHash] = [];
          filterQueryRequests[filterHash].push({
            query: query,
            callback: callback
          });

          // generate the request
          $.cometd.publish('/service/flow_profiles/create_transient_flow_profile', msg);
        }
      } else {
        // streakerClient wasn't ready, so retry in a moment
        window.setTimeout(function () {
          requestFilteredQueryChannel(query, filter, callback);
        }, 100);
      }
    };

    api.clearCache = function () {
      filterCache = {};
    };

    // need to track how many subscribers are using this transient FP; when it reaches zero it will be torn down, so we need
    //   to invalidate that cache entry
    api.decrementSubscribers = function (filter) {
      var filterHash = filterObjectToMD5(filter);

      if (filterCache[filterHash]) {
        filterCache[filterHash].subscribers--;

        if (filterCache[filterHash].subscribers <= 0) {
          delete filterCache[filterHash];
        }
      }
    };

    return api;
  })();

  /*
     options = {
       forceConnect: force a datasource to recieve updates, even if it has no subscribers,
       subscriber: only used for annotations, pass 'opaque'
       aggregate: array of meters to aggregate on
       filter: {
         country: array of two letter country codes to filter on [optional]
         transport: array of { port: #, protocol: # } values to filter on [optional]
       }
     }
  */
  var dataSource = function (query, options) {
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
          if (obj.hasOwnProperty(t)) {
            empty = false;
            break;
          }
        }

        return empty;
      }

      return {
        // returns null if current winds up being empty
        update: function (added, removed) {
          var i, len;

          for (i = 0, len = removed ? removed.length : 0; i < len; ++i) {
            delete current[removed[i].__key__];
          }

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

      var possiblyNoMeterData = false;

      function expand(source) {
        var out = [];

        out = bndry.utils.struct.unpack({
          schema: schema,
          keys: keys,
          data: source
        });

        return out;
      }

      return function (msg) {
        var data = msg.data,
            added = null,
            removed = null;

        // these fields come in the state dump
        if (data.schema) {
          schema = data.schema;
          keys = data.keys;
        }

        // if we didn't get inserts in the state dump, we aren't getting meter data for this query
        if (data.keys && data.schema && data.insert.length === 0) {
          possiblyNoMeterData = true;
        }

        if (schema) {
          if (data.insert && data.insert.length) {
            added = expand(data.insert);
            possiblyNoMeterData = false;
          }

          if (data.remove && data.remove.length) {
            removed = expand(data.remove);
          }
        }

        return {
          added: added,
          removed: removed,
          possiblyNoMeterData: possiblyNoMeterData
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
    function update(data, force) {
      // only update subscribers if we aren't restarting
      if (!restarting || force) {
        data.state = state.update(data.added, data.removed);

        // only update subscribers if we have state changes or need to report no meter data
        if (data.state || data.possiblyNoMeterData || force) {

          window.setTimeout(function () {
            var s;

            for (s in subscribers) {
              if (subscribers.hasOwnProperty(s)) {
                try {
                  updateSubscriber(subscribers[s], data);
                } catch (e) {
                  // need to handle this generically so we still update the other subscribers
                  if (e.stack) {
                    console.log(e.stack);
                  } else if (e.stackTrace) {
                    console.log(e.stackTrace);
                  } else {
                    console.log('Error: ' + e.type + ' - ' + e.message);
                  }
                }
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
      var filter = {}, f;

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
          if (options.filter) {
            streakerID = WAITING;

            for (f in options.filter) {
              if (options.filter.hasOwnProperty(f)) {
                filter[f] = options.filter[f];
              }
            }

            // grab meters from the aggregate value if it wasn't defined in filters
            if (!filter.meters && options.aggregate) {
              filter.meters = options.aggregate;
            }

            requestFilteredQueryChannel(query, filter, finish);
          } else if (options.aggregate) {
            streakerID = WAITING;
            requestAggregatedQueryChannel(query, options.aggregate, finish);
          } else {
            finish(query);
          }
        } else {
          // we need to wait for the handshake
          streakerID = WAITING;
          window.setTimeout(function () {
            connect(complete);
          }, 100);
        }
      }
    }

    // disconnect from streaker, with optional completion callback
    function disconnect(complete) {
      var filter = {}, f;

      if (streakerID) {
        if (streakerID === WAITING) {
          window.setTimeout(function () {
            disconnect(complete);
          }, 100);
        } else {
          // if this is a transient FP, we need to see if this disconnect will tear down the query set
          if (options.filter) {
            for (f in options.filter) {
              if (options.filter.hasOwnProperty(f)) {
                filter[f] = options.filter[f];
              }
            }

            // grab meters from the aggregate value if it wasn't defined in filters
            if (!filter.meters && options.aggregate) {
              filter.meters = options.aggregate;
            }

            requestFilteredQueryChannel.decrementSubscribers(filter);
          }

          streakerClient.unsubscribe(streakerID, function () {
            streakerID = null;
            state.clear();
            lastData = {};

            if (complete) {
              complete();
            }
          });
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
        // make sure "this" is properly bound to the subscriber's instance, in case that matters to the subscriber
        function bind(o, f) {
          return function () {
            var args = Array.prototype.slice.call(arguments);
            f.apply(o, args);
          };
        }

        // connect if we haven't already
        if (!streakerID) {
          connect();
        }

        // update the subscriber list with the new info
        // TODO: remove support for passing in objects with an update method
        subscribers[++uid] = {
          update: subscriber.update ? bind(subscriber, subscriber.update) : subscriber,
          transform: (transformation && typeof transformation === 'function' ?
                      bind(subscriber, transformation) : null)
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

      reconnect: function (warnSubscribers) {
        if (streakerID) {
          restarting = true;

          disconnect(function () {
            if (warnSubscribers) {
              update({ reconnecting: true }, true);
            }
            
            connect(function () {
              restarting = false;
            });
          });
        }
      },

      updateQuery: function (updatedQuery, updatedOptions) {
        updatedOptions = updatedOptions || {};

        if (streakerID) {
          restarting = true;

          disconnect(function () {
            if (updatedOptions !== undefined) {
              options = updatedOptions;
            }

            query = updatedQuery;
            connect(function () {
              restarting = false;
            });
          });
        } else {
          // not currently connected to streaker, so just update the options
          if (updatedOptions !== undefined) {
            options = updatedOptions;
          }

          query = updatedQuery;
        }
      },

      // update a data transformation function for a subscription (pass null to remove transformation)
      updateTransformation: function (id, transformation) {
        if (subscribers[id]) {
          subscribers[id].transform = (transformation && typeof transformation === 'function' ? transformation : null);

          // run an immediate update for this subscriber using the last update from streaker
          if ('state' in lastData) {
            updateSubscriber(subscribers[id], lastData);
          }
        }
      },

      lastUpdate: function () {
        return lastData;
      }
    };

    // store this interface in case streaker needs to reconnect us at some point
    activeDataSources.push(ds);

    return ds;
  };

  // expose public-facing functionality
  bndry.dataSource = dataSource;
  bndry.dataSource.create = dataSource;

})(bndry, jQuery);
