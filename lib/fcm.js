var util = require('util');
var https = require('https');
var querystring = require('querystring');
var emitter = require('events').EventEmitter;
var retry = require('retry');
var _ = require('lodash');
var debug = require('debug')('fcm-push');

function FCM(serverKey, retriableErrorsList) {
    if (serverKey) {
        this.serverKey = serverKey;
    } else {
        throw Error('No serverKey is given.');
    }

    this.fcmOptions = {
        host: 'fcm.googleapis.com',
        port: 443,
        path: '/fcm/send',
        method: 'POST',
        headers: {}
    };

    this.retriableErrorsList = retriableErrorsList || ['InternalServerError', 'Unavailable'];
    debug("Will retry to send notifications if one of these errors occur: ", this.retriableErrorsList);
}

util.inherits(FCM, emitter);

FCM.prototype.send = function(payload, CB) {
    var self = this;
    if (CB) this.once('sent', CB);
    var type = 'INDIVIDUAL_MESSAGE';
    if((payload.to && payload.to.indexOf('/topics/') >= 0) || payload.condition){
        type = 'TOPIC_MESSAGE'
    }
    debug("Type: ", type);
    var operation = retry.operation();

    payload = JSON.stringify(payload);

    operation.attempt(function(currentAttempt) {
        var headers = {
            'Host': self.fcmOptions.host,
            'Authorization': 'key=' + self.serverKey,
            'Content-Type': 'application/json',
            'Content-Length': new Buffer(payload).length
        };

        self.fcmOptions.headers = headers;

        if (self.keepAlive) headers.Connection = 'keep-alive';

        var request = https.request(self.fcmOptions, function(res) {
            var data = '';

            if (res.statusCode == 503) {
                // If the server is temporary unavailable, the C2DM spec requires that we implement exponential backoff
                // and respect any Retry-After header
                if (res.headers['retry-after']) {
                    var retrySeconds = res.headers['retry-after'] * 1; // force number
                    if (isNaN(retrySeconds)) {
                        // The Retry-After header is a HTTP-date, try to parse it
                        retrySeconds = new Date(res.headers['retry-after']).getTime() - new Date().getTime();
                    }
                    if (!isNaN(retrySeconds) && retrySeconds > 0) {
                        operation._timeouts['minTimeout'] = retrySeconds;
                    }
                }
                if (!operation.retry('TemporaryUnavailable')) {
                    self.emit('sent', operation.mainError(), null);
                }
                // Ignore all subsequent events for this request
                return;
            }

            res.on('data', function(chunk) {
                data += chunk;
            });
            res.on('end', handleResult);
            res.on('close', handleResult);

            function handleResult(){
                handleMessageResult(self, operation, res, data, type, currentAttempt, self.retriableErrorsList);
            }

        });

        request.on('error', function(error) {
            self.emit('sent', error, null);
        });

        request.end(payload);
    });
};

/**
 * success response format:
 * {    "multicast_id":7209313802545038449,
 *      "success":1,
 *      "failure":0,
 *      "canonical_ids":0,
 *      "results": [
 *          {"message_id":"0:1473772989195200%7d2b7e997d2b7e99"}
 *      ]
 * }
 *
 * @param self
 * @param operation
 * @param res
 * @param data
 * @param type
 * @param currentAttempt
 * @param retriableErrorsList
 */
function handleMessageResult(self, operation, res, data, type, currentAttempt, retriableErrorsList) {
    debug("FCM server response:", res.statusCode, data);
    try {
        data = JSON.parse(data);
    }
    catch(ex){
        debug("unable to parse data: ", ex);
        self.emit('sent', ex.message, null);
        return;
    }

    if(type == 'TOPIC_MESSAGE' && data.message_id && !data.failure){
        // all good. message was sent successfully
        debug("Success");
        self.emit('sent', null, data.message_id);
    }
    else if(data.success >= 1){
        // all good. message was sent successfully. some might have failed, but that's for user to worry.
        // he sent some wrong ids. show him the result to take care of it.
        debug("Success");
        self.emit('sent', null, data.results);
    }
    else {
        // some error occurred
        debug("Failure");
        debug("Attempts count: ", currentAttempt);
        var retriableError  = currentAttempt <= 3 && _.get(_.find(data.results, function(obj) {
                return retriableErrorsList.indexOf(obj.error) >= 0;
            }), 'error');

        debug("Will retry?", retriableError ? retriableError : 'No');
        if (retriableError) {
            operation.retry(retriableError);
            return;
        }
        debug("A non retriable error occurred. Checkout the results : ", data.results);
        self.emit('sent', data.results, data.multicast_id);
    }
}


module.exports = FCM;


