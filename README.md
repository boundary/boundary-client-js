# Boundary JavaScript API

### October Preview

---

Note: This documentation represents the current status of the Boundary JavaScript API as of October 28, 2012. While we will make a best effort to maintain compatibility and provide advance notice of API changes, all APIs and output formats described below are subject to change.

## Overview

The Boundary JavaScript API encapsulates the functionality required to authenticate and manage CometD subscriptions to the Boundary Streaming API service. The JavaScript API allows you to retrieve streaming JSON data from various Boundary endpoints, or "data sources," and associate that incoming data with any JavaScript object that implements an "update" method. One common use of this functionality would be to create browser-based visualizations of the traffic data being reported for your organization. It is the basis of Boundary's own visualization front end.

## External Requirements

The following files, supplied in the repository, are required to run the JavaScript API:

* **/lib/jquery-1.6.4.min.js** - jQuery (any recent version will do)
* **/lib/org/cometd.js** - CometD 
* **/lib/org/cometd/TimeSyncExtension.j**s - TimeSyncExtension for CometD
* **/lib/jquery.cometd.js** and **lib/jquery.cometd-timesync.js** - jQuery CometD bindings

## API Files

The Boundary JavaScript API itself is comprised of two files:

* **/bndry/auth.js** - stores credentials for subscribing to the Boundary Streaming service
* **/bndry/data-source.js** - defines the bndry.dataSource object, which is used to create query-specific data sources, which can be subscribed to by other objects

**NOTE: You will need to edit the auth.js file with your Boundary account information in order to use the JavaScript API.** You can find this information at [https://boundary.com/account](https://boundary.com/account).

## The Bndry Namespace

The Boundary JavaScript API defines a base object called **bndry** in the global namespace. It has two child objects:

* **bndry.auth** - object representing the credentials necessary for subscribing to data from the Streaming API
* **bndry.dataSource** - a method for creating dataSources.

## Authentication

In order for the Boundary JavaScript API to function, the bndry.auth object must be defined.

	bndry = bndry || {};
	bndry.auth = {
	    cometd: "https://api.boundary.com/streaming",
    	user: [user email],
	    org_id: [org_id string],
    	apikey: [api key]
	};

In the repo, this is defined in **/bndry/auth.js**. You will need to replace the information in that file with your own account credentials, which may be retrieved from [https://boundary.com/account](https://boundary.com/account).

## dataSources

A dataSource object manages the connection to a single query in the Boundary Streaming API, and allows subscriber objects to recieve updates from the dataSource as they arrive from the API. It is defined in the **/bndry/data-source.js** file, which will create the **bndry.dataSource** object. Calling this method will return a new dataSource instance, which other objects may subscribe to:

	bndry.dataSource.create(query, [options]) -> dataSource

The second, optional argument passed to the dataSource **create** method is an object specifying additional configuration parameters:

* **updateInterval** - may be passed to the dataSource method to force the dataSource to return updates at regular intervals, instead of waiting for updates from the server. This is most useful at the 1 second time resolution, to smooth out updates
* **forceConnect** - normally, a dataSource will not poll the streaming API for updates unless it has at least one subscriber. This option forces dataSource to poll the API regardless.
* **subscription** - currently only required to subscribe to annotations, in which case it should be set to 'opaque'.

To force subscription updates every second, regardless of new data from the API:

	var source = bndry.dataSource.create('volume_1s', { updateInterval: 1000 });

To subscribe to annotation updates:

	var source = bndry.dataSource.create('annotations', { subscription: 'opaque' });

For a list of all available queries in the Streaming API, see the Data Sources section of [the Streaming API Documentation](https://boundary.com/docs#streaming_api).

## dataSource subscribers

A dataSource subscriber is any object that has defined an **update** method. Once an object has subscribed to recieve updates from a dataSource, it will begin recieving data objects from the Streaming API via this method.

An example of a subscriber that simply log's Streaming API data:

	var logger = {
		update: function (data) {
			console.log(data);
		}
	};

## dataSource updates

The required **update** method recieves updates from the dataSource. If a transformation function has not been paired with this subscriber (discussed in the [addSubscriber](#add-subscriber) section in [dataSource Methods](#data-source-methods)), then the update object will have the following fields:

* **state** - list of all currently tracked samples for the dataSource's query, keyed by a unique field named **\_\_key\_\_**, which is a composite of the sample's other fields concatenated with the ':' character
* **added** - list of samples added to the state since the last update
* **removed** - list of samples removed from the state since the last update

<a id="data-source-methods"></a>
## dataSource Methods

Once a dataSource instance has been created, any number of subscription objects may subscribe to it for updates, unsubscribe from updates, request the most recent data recieved from the Streaming API, or update their optional transformation functions.

<a id="add-subscriber"></a>
### addSubscriber

Registers a subscriber object to start recieving data from the Streaming service. Calling this method returns a subscription identifier, which may be used to update or remove the subscription later.

	datasource.addSubscriber(subscriber_object, [transformation]) -> subscription_id

An optional **transformation** function may be provided to process the data before it is handed off to the subscriber's **update** method. The transformation function is any function that takes a data object and a callback as input, and passes it's processed data to the supplied callback method when it is finished. This allows for potentially asynchronous data processing, such as using web workers.

	var transformation = function (data, callback) {
		var transformed_data = {};

		… map incoming data to the transformed_data set …

		callback(transformed_data);
	}

The **addSubscriber** method returns a subscription identifier, which may be used to unsubscribe the object from it's dataSource at any time.

Example: subscribing to a total volume per second stream, with an optional forced update interval of one second:

	var source = bndry.dataSource.create('volume_1s', { updateInterval: 1000 });
	var logger = {
		update: function (data) {
			console.log(data);
		}
	};
	var subscription = source.addSubscriber(logger);

### updateTransformation

Updates the transformation function associated with a particular subscriber.

	datasource.updateTransformation(subscription_id, transform_function)

Calling this method will immediately update the subscriber associated with this subscription_id, using the new transformation function.

### removeSubscriber
	
Decouples a subscription object from a dataSource.

	datasource.removeSubscriber(subscription_id)

Onced called, the subscription object associated with that subscription_id will no long recieve updates from the dataSource instance.

### lastUpdate

Returns the last data object sent to all subscribers.

	datasource.lastUpdate() -> unprocessed data object