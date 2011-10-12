# Boundary JavaScript API

### October Preview

---

Note: This documentation represents the current status of the Boundary JavaScript API as of October 12, 2012. While we will make a best effort to maintain compatibility and provide advance notice of API changes, all APIs and output formats described below are subject to change.

## Overview

The Boundary JavaScript API encapsulates the functionality required to authenticate and manage CometD subscriptions to the Boundary Streaming API service. The JavaScript API allows you to retrieve streaming JSON data from various Boundary endpoints, or "data sources," and associate that incoming data with any JavaScript object that implements an "update" method. One common use of this functionality would be to create browser-based visualizations of the data being reported for your organization.

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

## Data Sources

Once the auth object is defined, you must include the **/bndry/data-source.js** file, which will create the **bndry.dataSource** method. Calling this method will return a new dataSource instance, which other objects may subscribe to:

	bndry.dataSource(query, [update_interval])

An optional update interval value may be passed to the dataSource method to force the dataSource to return updates at regular intervals, instead of waiting for updates from the server. This is most useful at the 1 second time resolution, to smooth out updates.

An example:

	var source = bndry.dataSource('volume_1s', 1000);

## Subscribing to a dataSource

Once a dataSource instance has been created, any number of arbitrary objects that define an "update" method may subscribe to it. A dataSource defines the following methods.

### addSubscriber

	datasource.addSubscriber(object) -> subscription_id

Registers an object that defines an update method to start recieving data from the Streaming service. It returns a subscription object, which may be used to unsubscribe the object from that dataSource. Speaking of which…

### removeSubscriber
	
	datasource.removeSubscriber(subscription_id)

Deregisters an object from recieving updates from a dataSource.

#### Example

Subscribing to a total volume per second stream, with an optional forced update interval of one second:

	var source = bndry.dataSource('volume_1s', 1000);
	var logger = {
		update: function (data) {
			console.log(data);
		}
	};
	var subscription = source.addSubscriber(logger);

## dataSource subscribers

Once an object has subscribed to updates from a dataSource, it will begin recieving data objects via it's own update method. Note that a subscriber object **must** implement an update method, and may also implement an optional dataProcessor method.

### dataProcessor(data, callback)

If defined, the dataSource will call this method to process the raw subscription data into a different format. It must be returned via the supplied callback before it can be handed off to the object's update method.

An example:
	
	var source = bndry.dataSource('volume_1s', 1000);
	var logger = {
		dataProcessor: function (data, callback) {
			var ingressOctets = [];
			for (s in data.state) {
				ingressOctets.push(data.state[s].ingressOctetTotalCount);
			}
		},
		update: function (octetList) {
			console.log(octetList);
		}
	};
	var subscription = source.addSubscriber(logger);
	

### update(data)

This required method recieves updates from the dataSource. If a dataProcessor method was not defined, then the format of this object is described below. Otherwise, the format of will be defined by the dataProcessor method.

## The data object

Updates from the Streaming API are processed by the dataSource and delivered to subscribers in the following format:

* **state** - list of all currently tracked samples, categorized by a unique field named \_\_key\_\_
* **added** - list of samples added to the state set since the last update
* **removed** - list of samples removed from the state set since the last update
