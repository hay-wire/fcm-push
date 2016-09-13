/**
 * Created by haywire on 13/09/16.
 */

var FCM = require('../');

var serverKey = 'your-fcm-server-key-here';
var fcm = new FCM(serverKey);

var message = {
    //registration_ids: ['device-token-1', 'device-token-2'],
    //to: 'device-token-1',
    //to: '/topics/my_topic',
    //condition: "'my_topic' in topics || 'some_topic' in topics",
    collapse_key: 'requestid_2134',
    data: {
        custom_data_key: 'requestid_2134',
        details: {
            name: 'Haywire',
            phone: '1234567890',
            area_code: 1223,
            area_name: 'Delhi'
        }
    },
    notification: {
        title: 'New Pickup',
        body: 'Hey we have got a new pickup! Click here to check it out now.'
    }
};

fcm.send(message, function(err, response){
    if (err) {
        console.log("Something has gone wrong!", err);
    } else {
        console.log("Successfully sent with response: ", response);
    }
});