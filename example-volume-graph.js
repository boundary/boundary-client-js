window.onload = function () {

  var volumeData = bndry.dataSource.create('volume_1s'),
      subscription = null,

      canvas = document.getElementById('graph'),
      width = canvas.width,
      height = canvas.height;

  /*
     Processes the state field into a more useful form for drawing a bar graph over a time interval.
     For the volume_1s query, the state key is the timestamp of the sample.
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
    return sortedIngressValues;
  }
  
  /*
     The data argument passed to the subscriber function has the following format:

       data = {
         added: items that have been added to the data set since the last update,
                stored by key; undefined if none
         removed: items that have been removed from the data set since the last update,
                  stored by key; undefined if none
         state: all items currently being reported from the Streaming API for this query,
                stored by key
       }
  */
  function update(data) {
    var context = canvas.getContext('2d'),
        lineWidth,
        sampleCount,
        sampleHeight,
        sample;

    data = normalizeOctets(data);
    sampleCount = data.length,
    lineWidth = width / sampleCount,
    
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#555';

    // loop over the samples and render them to scale in the graph
    for (var i = 0; i < sampleCount; ++i) {
      sample = data[i];
      sampleHeight = sample * height;
      
      context.fillRect(width - (i + 1) * lineWidth,
                       height - sampleHeight,
                       lineWidth,
                       sampleHeight);
    }
  }

  function subscribe() {
    /* subscribe to the dataSource, passing the function to call when updates
       are recieved from the Streaming API */
    subscription = volumeData.addSubscriber(update);
    
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

  // kick everything off by subscribing the graph to the datasource
  subscribe();
};