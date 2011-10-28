window.onload = function () {

  // create the data source, passing an optional value to force updates every second, regardless of new data
  var volumeData = bndry.dataSource.create('volume_1s', { updateInterval: 1000 }),
      subscription = null;

  function subscribe() {
    // subscribe to the dataSource, passing in an optional data transformation function
    //   to normalize the data for graphing
    subscription = volumeData.addSubscriber(graph, normalizeOctets);
    
    document.getElementById('subscribe').disabled = true;
    document.getElementById('unsubscribe').disabled = false;
  }

  function unsubscribe() {
    // unsubscribe from the data source using the subscription id we stored earlier
    volumeData.removeSubscriber(subscription);
    
    subscription = null;
    document.getElementById('subscribe').disabled = false;
    document.getElementById('unsubscribe').disabled = true;
  }
  
  document.getElementById('subscribe').onclick = subscribe;
  document.getElementById('unsubscribe').onclick = unsubscribe;

  /*
     Processes the state field into a more useful form for drawing a bar graph over a time interval.
     For the volume_1s query, the state key is the timestamp of the sample.

     The callback will return the data to the dataSource for handoff to the subscriber.
  */
  function normalizeOctets (data, callback) {
    var maxIngressValue = 0,
        sortedIngressValues = [],
        sampleRange = 600,
        currentTime = Math.floor((new Date()).getTime() / 1000) * 1000,
        timestamp,
        i;

    // step over each second backwards, and see if there is an ingress octet value to store
    for (timestamp = currentTime - (1000 * sampleRange); timestamp <= currentTime; timestamp += 1000) {
      if (data.state[timestamp]) {
        sortedIngressValues.push(data.state[timestamp].ingressOctetTotalCount);
        maxIngressValue = Math.max(data.state[timestamp].ingressOctetTotalCount, maxIngressValue);
      } else {
        sortedIngressValues.push(0);
      }
    }

    // loop over the data again and scale it by the maximal octet value,
    //   so each ingress value is mapped to a range of [0, 1]
    for (i = 0; i <= sampleRange; ++i) {
      sortedIngressValues[i] /= maxIngressValue;
    }

    // return the processed, time-ordered data for handoff to dataSource subscribers
    callback(sortedIngressValues.reverse());
  }
  
  /*
     The graph object will subscribe to a dataSource. A dataSource subscriber has one
     required field, update. Without a transformation provided with the object's dataSource
     subscription, the data argument passed to update would look like the following:

         data = {
           added: items that have been added to the data set since the last update,
                  stored by key; undefined if none
           removed: items that have been removed from the data set since the last update,
                    stored by key; undefined if none
           state: all items currently being reported from the Streaming API for this query,
                  stored by key
         }

       However, since we've defined a transformation function to smooth out, normalize, and order
       the data being recieved by this subscriber, our update method will recieve an array of
       numbers scaled from 0 to 1, representing the relative height of each sample in the graph.
  */
  var graph = {
    canvas: document.getElementById('graph'),
    
    update: function (data) {
      var width = this.canvas.width,
          height = this.canvas.height,
          context = this.canvas.getContext('2d'),
          i = 0,
          samples = data.length,
          lineWidth = width / samples,
          sample,
          sampleHeight;

      context.clearRect(0, 0, width, height);
      context.fillStyle = '#555';

      // loop over the samples and render them to scale in the graph
      for (; i < samples; ++i) {
        sample = data[i];
        sampleHeight = sample * height;
        
        context.fillRect(width - (i + 1) * lineWidth,
                         height - sampleHeight,
                         lineWidth,
                         sampleHeight);
      }
    }
  };

  // kick everything off by subscribing the graph to the datasource
  subscribe();

};