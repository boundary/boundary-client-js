window.onload = function () {
  var subscribeBtn = document.getElementById('subscribe'),
      unsubscribeBtn = document.getElementById('unsubscribe'),
      canvas = document.getElementById('graph');
  
  var volumeData = bndry.dataSource('volume_1s', 1000),
      subscription = null;

  function subscribe() {
    subscription = volumeData.addSubscriber(graph);    
    subscribeBtn.disabled = true;
    unsubscribeBtn.disabled = false;
  }

  function unsubscribe() {
    volumeData.removeSubscriber(subscription);
    subscription = null;
    subscribeBtn.disabled = false;
    unsubscribeBtn.disabled = true;
  }
  
  subscribeBtn.onclick = subscribe;
  unsubscribeBtn.onclick = unsubscribe;

  /*
     The graph object will subscribe to a dataSource. A dataSource subscriber has one required field, update.
     An optional method, dataProcessor, may be defined to transform the data to be recieved by update before
     update is called.
  */
  var graph = {
    /*
       Processes the state field into a more useful form for drawing a bar graph over a time interval.
       For the volume_1s query, the state key is the timestamp of the sample.

       The callback will return the data to the dataSource for handoff to the update method.
    */
    dataProcessor: function (data, callback) {
      var maxIngressValue = 0,
          sortedIngressValues = [],
          sampleRange = 600,
          currentTime = Math.floor((new Date()).getTime() / 1000) * 1000,
          timestamp;

      // step over each second backwards, and see if there is an ingress octet value to store
      for (timestamp = currentTime - (1000 * sampleRange); timestamp < currentTime; timestamp += 1000) {
        if (data.state[timestamp]) {
          sortedIngressValues.push(data.state[timestamp].ingressOctetTotalCount);
          maxIngressValue = Math.max(data.state[timestamp].ingressOctetTotalCount, maxIngressValue);
        } else {
          sortedIngressValues.push(0);
        }
      }

      // return the processed data to dataSource for handoff to update
      data = {
        maxIngressValue: maxIngressValue,
        times: sortedIngressValues
      };

      callback(data);
    },

    /*
       Called by the dataSource to refresh the graph; note that if we did not define a dataProcessor method to
       customize our data, data would consist of three fields:

         data.added: items that have been added to the data set since the last update, stored by key; undefined if none
         data.removed: items that have been removed from the data set since the last update, stored by key; undefined if none
         data.state: all items currently being reported, stored by key

       Since we have defined a dataProcessor method to smooth out and order our data per second, we have the
       following fields available:

         data.times: an array of octet values arranged in ascending order, starting with the current second
         data.maxIngressValue: the maximal ingress octect value in data.items
    */
    update: function (data) {
      var width = canvas.width,
          height = canvas.height,
          context = canvas.getContext('2d'),
          max = data.maxIngressValue,
          i = 0,
          samples = data.times.length,
          lineWidth = width / samples,
          val;

      context.clearRect(0, 0, width, height);
      context.fillStyle = '#555';

      // loop over the samples and render them to scale in the graph
      for (; i < samples; ++i) {
        val = data.times[i];
        context.fillRect(width - (i + 1) * lineWidth,
                         height - val * height / max,
                         lineWidth,
                         val * height / max);
      }
    }
  };

  // kick everything off by subscribing the graph to the datasource
  subscribe();
};