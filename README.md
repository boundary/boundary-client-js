# Boundary JavaScript API

## Overview

The Boundary JavaScript API manages authentication and streaming data subscriptions for the Boundary Streaming API service. The API allows you to retrieve streaming updates relating to various aspects of your Boundary-monitored network in JSON format using a set of [predefined queries](https://app.boundary.com/docs/streaming_api#datasources). One common use of this functionality would be to create browser-based visualizations of the traffic data being reported for your organization. It is the basis of Boundary's own visualization front end.

## External Requirements

The following files, supplied in the repository, are required to run the JavaScript API:

* **/lib/jquery-1.6.4.min.js** - jQuery (any recent version will do)
* **/lib/md5.js** - CryptoJS MD5
* **/lib/org/cometd.js** - CometD 
* **/lib/org/cometd/TimeSyncExtension.js** - TimeSyncExtension for CometD
* **/lib/jquery.cometd.js** and **lib/jquery.cometd-timesync.js** - jQuery CometD bindings

## API Files

The Boundary JavaScript API itself is comprised of two files:

* **/bndry/auth.js** - stores credentials for subscribing to the Boundary Streaming service
* **/bndry/data-source.js** - defines the bndry.dataSource object, which is used to create query-specific data sources, which can then be subscribed to

**NOTE: You will need to edit the included auth.js file with your Boundary account information in order to use the JavaScript API.** You can find this information at [https://app.boundary.com/account](https://app.boundary.com/account).

## The Bndry Namespace

The Boundary JavaScript API defines a base object called **bndry** in the global namespace. It has two child objects:

* **bndry.auth** - object representing the credentials necessary for subscribing to data from the Streaming API
* **bndry.dataSource** - a method for creating dataSources.

## Authentication

In order for the Boundary JavaScript API to function, the bndry.auth object must be defined.

	bndry = bndry || {};
	bndry.auth = {
	    cometd: "https://api.boundary.com/streaming",
	    org_id: [org_id string],
    	apikey: [api key]
	};

In the repo, this is defined in **/bndry/auth.js**. You will need to replace the information in that file with your own account credentials, which may be retrieved from [https://app.boundary.com/account](https://app.boundary.com/account).

<a id="data-source-creation"></a>
## dataSources

A dataSource object manages the connection to a single query in the [Boundary Streaming API](https://app.boundary.com/docs/streaming_api), and allows subscribers to receive updates from the dataSource as they arrive from the API. It is defined in the **/bndry/data-source.js** file, which instantiates the **bndry.dataSource** object. Calling the **create** method of this object will return a new dataSource instance, which you may then [subscribe](#add-subscriber) to:

	bndry.dataSource.create(query, [options]) -> dataSource

The second, optional argument passed to the dataSource **create** method defines additional configuration parameters:

* **aggregate** - limit the incoming query data to a set of meters (see [Meter Aggregation](#meter-aggregation) below)
* **filter** - filter the incoming query data along several possible axes (see [Filtering](#query-filtering) below)
* **forceConnect** - normally, a dataSource will not poll the streaming API for updates unless it has at least one subscriber; when set to **true**, this option forces dataSource to poll the API regardless
* **subscription** - currently only required to subscribe to annotations, in which case it should be set to 'opaque'

An example dataSource for traffic volume data tracked every second by all meters in your organization, filtered to traffic to or from the US and aggregated by meters with particular observation domain IDs:

	var source = bndry.dataSource.create(
		'volume_1s_meter',
		{
			aggregate: [4, 7, 34],
			filter: {
				country: ["US"]
			}
		}
	);

A simple annotation query example:

	var source = bndry.dataSource.create('annotations', { subscription: 'opaque' });

For a list of all available queries in the Streaming API, see the **Data Sources** section of [the Streaming API Documentation](https://app.boundary.com/docs/streaming_api#datasources).

<a id="meter-aggregation"></a>
### Meter Aggregation
Normally, a dataSource query will return data for all meters in your organization. If you would like to see data for only a subset of your meters, set the **aggregate** field in the options parameter to an array of observation domain IDs for those meters.

Each meter in your organization has a unique observation domain ID, represented by an integer value. One way to get a list of observation domain IDs and the meters they belong to is to use the Search API:

	curl -u <your api key> \
		https://api.boundary.com/<your organization id>/search?types=meter

This will return a JSON blob with an "entities" field containing an entry for every meter in your organization.

Another way to obtain meter observation domain IDs for your organization to subscribe to the "meter_status" query via dataSource. The first update will return a list of all meters in your organization, along with their observation domain IDs and many other fields.

Once you have a list of observation domain IDs, you can limit a query's data to a subset of your organization's meters:

	{
		aggregate: [4, 7, 34]
	}
	
<a id="query-filtering"></a>
### Filtering
dataSource queries are filterable along several axes:

* **country** - limit the data to packets coming from or going to a set of countries ([valid country codes](http://www.maxmind.com/app/iso3166))
* **transport** - limit data to packets coming from or going to a set of port:protocol pairs, listed as decimal values ([valid decimal protocol values](http://www.iana.org/assignments/protocol-numbers/protocol-numbers.xml))
* **ip addresses** - limit data to packets coming from or going to a set of ip addresses

A sample filter, which would only show traffic to or from the US or Russia, to ports 80:TCP or 4047:TCP, with a source or destination IP address of 4.2.2.1:

	{
		filter: {
			country: ["US", "RU"],
			transport: [{ port: 80, protocol: 6 }, { port: 4047, protocol: 6 }],
			ips: ["4.2.2.1"]
		}
	}

**Important:** filtered queries are short-lived; filtering a query results in a new, temporary query being generated behind-the-scenes inside the Streaming API. As such, all filtered queries will initially appear empty, and will begin accumulating historic data from that moment on. When all subscribers to that query have disconnected, the filtered query and its associated history will be destroyed. Additionally, a filtered query may initially trigger reciept of a **possiblyNoMeterData** update field (see [dataSource updates](data-source-updates) for a description of that field).

<a id="data-source-methods"></a>
## dataSource Methods

* [addSubscriber](#add-subscriber)
* [removeSubscriber](#remove-subscriber)
* [updateQuery](#update-query)
* [updateTransformation](#update-transformation)
* [lastUpdate](#last-update)
* [reconnect](#reconnect)

<a id="add-subscriber"></a>
### addSubscriber

Registers a callback function to receive data from the Streaming API service. Calling this method returns a subscription identifier, which may be used to update or remove the subscribed callback later.

	source.addSubscriber(subscriber_callback, [transformation]) -> subscription_id

**subscriber_callback** is a function that receives a single argument, an object containing updates to the current recordset for your query, as well as the overall state of the query itself. See [dataSource Updates](#data-source-updates) for more information.

	var source = bndry.dataSource.create('volume_1s');

	source.addSubscriber(function (data) {
		console.log(data);
	});

An optional **transformation** function may be provided to process the data before it is handed off to the subscriber callback. The transformation function is any function that takes the Streaming API update argument and a callback as input, and hands off it's processed update argument to the supplied callback method when it is finished. This callback method allows asynchronous processing of large amounts of Streaming API data, for instance with web workers.

	var transformation = function (data, callback) {
		var transformed_data = {};

		… map incoming data to the transformed_data set …

		callback(transformed_data);
	}

The **addSubscriber** method returns a subscription identifier, which may be used to unsubscribe the **subscriber_callback** function from it's dataSource at any time.

Example: subscribing to updates from a total volume per second stream:

	var source = bndry.dataSource.create('volume_1s');

	function logger(data) {
		console.log(data);
	};

	var subscription = source.addSubscriber(logger);
	
<a id="remove-subscriber"></a>
### removeSubscriber
	
Decouples a subscriber from a dataSource.

	source.removeSubscriber(subscription_id)

Once called, the subscriber associated with that subscription_id will no long receive updates from the dataSource instance.

When a dataSource has no subscribers, it will automatically disconnect from the Streaming API, unless the **forceConnect** option has been set.

<a id="update-query"></a>
### updateQuery

Reconfigures an existing dataSource's query and options, using the same set of paramters as dataSource instantiation:

	source.updateQuery(query, [options])
	
Calling this method will notify all subscribers of a pending reconnection, and then will reconnect to the Streaming API with the updated parameters.

See the [dataSource section](#data-source-creation) for parameter details.

<a id="update-transformation"></a>
### updateTransformation

Updates the optional transformation function associated with a particular subscription.

	source.updateTransformation(subscription_id, transform_function)

Calling this method will immediately update the subscriber associated with this subscription_id, using the new transformation function.

<a id="last-update"></a>
### lastUpdate

Returns the last, untransformed data object sent to all subscribers:

	source.lastUpdate() -> update object
	
<a id="reconnect"></a>
### reconnect

Performs a disconnection and subsequent reconnection to the Streaming API.

	source.reconnect(true);

Pass **true** to this method to notify all subscribers that a reconnection is about to occur. Each subscriber's update function will be called and passed an object with the field **reconnecting** set to **true**. It is important for subscribers to be aware of reconnections, as a reconnection will result in a new state dump from the Streaming API, which can invalidate any previous query data subscribers may retain.

This method is primarily used internally when dataSource needs to reset the connection to the Streaming API, usually due to a polling time-out.

<a id="data-source-updates"></a>
## dataSource updates

If a transformation function has not been paired with your subscription (discussed in the [addSubscriber](#add-subscriber) section in [dataSource Methods](#data-source-methods)), then the update object received by the subscriber_callback function will usually contain one or more of the following fields:

* **state** - list of all currently tracked records for the dataSource's query, keyed by the field **\_\_key\_\_**, which is composed of the record's other uniquely identifying fields joined with the ':' character (for a time-based port:protocol query, the **\_\_key\_\_** would be **[record's epochal time]:[port value]:[protocol value]**)
* **added** - list of records added to the state since the last update
* **removed** - list of records removed from the state since the last update

**Important:** When processing updates in a subscriber, always apply the **removed** list, then the **added** list. This ensures that all events which have left the present query are properly removed from your local state before new records are added. If events that you’ve already seen are being updated, you wouldn’t want to remove the data you’ve just added! This is the same process used to maintain the **state** field every update.

There are also two special-case fields that may be included in the parameter passed to subscribers:

* **possiblyNoMeterData** - dataSource uses a set of heuristics to determine when the Streaming API may not have any data to show for your current query. When it detects this state, this field will be set to **true**. This may happen because the meters in the organization are not properly reporting data to Boundary's collectors, or because a combination of aggregation and filtering has constrained the query to an empty set for a particular time resolution. This field is only a guess; you may eventually start recieving proper updates from the Streaming API even after receiving this flag, as will often happen with newly-filtered queries. 
* **reconnecting** - when this field is set to **true**, dataSource is about to reconnect to the Streaming API, either due to updated dataSource options or because connectivity with the Streaming API was lost. Any internal state data stored by the subscriber should be discarded in anticipation of new data in the next update.

---

### Recent updates to the Boundary Javascript API:
March 22, 2012:

* Added aggregate and filter options to dataSource creation
* Added updateQuery and reconnect methods
* Two new possible fields in parameter passed to dataSource subscribers: possiblyNoMeterData and reconnecting
* Several bug fixes
* Fixed some typos, probably added some new ones

December 28, 2011:

* Removed optional update interval smoothing from dataSource creation
* Updated bndry.auth object to V2 authentication (if you've previously been using the Boundary Javascript API files, you may want to check [https://app.boundary.com/account](https://app.boundary.com/account) to see if your api key has changed)
* dataSource subscribers are no longer objects with update methods, but are now simply callback functions
* the included example js file has been simplified to better illustrate baseline usage