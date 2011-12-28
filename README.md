# Boundary JavaScript API

### December Preview

---

Note: This documentation represents the current status of the Boundary JavaScript API as of December 28, 2011. While we will make a best effort to maintain compatibility and provide advance notice of API changes, all APIs and output formats described below are subject to change.

## Overview

The Boundary JavaScript API manages authentication and streaming data subscriptions for the Boundary Streaming API service. The API allows you to retrieve streaming updates relating to various aspects of your Boundary-monitored network in JSON format using a set of [predefined queries](https://app.boundary.com/docs#streaming_api). One common use of this functionality would be to create browser-based visualizations of the traffic data being reported for your organization. It is the basis of Boundary's own visualization front end.

## External Requirements

The following files, supplied in the repository, are required to run the JavaScript API:

* **/lib/jquery-1.6.4.min.js** - jQuery (any recent version will do)
* **/lib/org/cometd.js** - CometD 
* **/lib/org/cometd/TimeSyncExtension.j**s - TimeSyncExtension for CometD
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

## dataSources

A dataSource object manages the connection to a single query in the Boundary Streaming API, and allows subscribers to receive updates from the dataSource as they arrive from the API. It is defined in the **/bndry/data-source.js** file, which will create the **bndry.dataSource** object. Calling the **create** method of this object will return a new dataSource instance, which you may subscribe to:

	bndry.dataSource.create(query, [options]) -> dataSource

The second, optional argument passed to the dataSource **create** method defines additional configuration parameters:

* **forceConnect** - normally, a dataSource will not poll the streaming API for updates unless it has at least one subscriber. This option forces dataSource to poll the API regardless.
* **subscription** - currently only required to subscribe to annotations, in which case it should be set to 'opaque'.

An annotation query example:

	var source = bndry.dataSource.create('annotations', { subscription: 'opaque' });

For a list of all available queries in the Streaming API, see the Data Sources section of [the Streaming API Documentation](https://app.boundary.com/docs#streaming_api).

<a id="data-source-methods"></a>
## dataSource Methods

Once a dataSource instance has been created, any number of subscriber callback functions may be added to receive streaming updates. You may also unsubscribe callback functions from receiving updates, request the most recent update received from the Streaming API, or update the optional transformation function for a particular subscriber.

<a id="add-subscriber"></a>
### addSubscriber

Registers a callback function to receive data from the Streaming API service. Calling this method returns a subscription identifier, which may be used to update or remove the subscribed callback later.

	datasource.addSubscriber(subscriber_callback, [transformation]) -> subscription_id

**subscriber_callback** is a function that receives a single argument, an object containing updates to the current recordset for your query, as well as the overall state of the query itself. See [dataSource Updates](#data-source-updates) for more information.

	var datasource = bndry.dataSource.create('volume_1s');

	datasource.addSubscriber(function (data) {
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

### updateTransformation

Updates the optional transformation function associated with a particular subscription.

	datasource.updateTransformation(subscription_id, transform_function)

Calling this method will immediately update the subscriber associated with this subscription_id, using the new transformation function.

### removeSubscriber
	
Decouples a subscriber from a dataSource.

	datasource.removeSubscriber(subscription_id)

Once called, the subscriber associated with that subscription_id will no long receive updates from the dataSource instance.

### lastUpdate

Returns the last data object sent to all subscribers.

	datasource.lastUpdate() -> unprocessed data object

<a id="data-source-updates"></a>
## dataSource updates

If a transformation function has not been paired with your subscription (discussed in the [addSubscriber](#add-subscriber) section in [dataSource Methods](#data-source-methods)), then the update objects received by the subscriber_callback function will contain the following fields:

* **state** - list of all currently tracked samples for the dataSource's query, keyed by a unique field named **\_\_key\_\_**, which is a composite of the sample's other fields concatenated with the ':' character
* **added** - list of records added to the state since the last update
* **removed** - list of records removed from the state since the last update

---

### Recent updates to the Boundary Javascript API:
December 28, 2011:

* Removed optional update interval smoothing from dataSource creation
* Updated bndry.auth object to V2 authentication (if you've previously been using the Boundary Javascript API files, you may want to check [https://app.boundary.com/account](https://app.boundary.com/account) to see if your api key has changed)
* dataSource subscribers are no longer objects with update methods, but are now simply callback functions
* the included example js file has been simplified to better illustrate baseline usage