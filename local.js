'use strict';

/*
Author: Fortinet
*/
console.log('Start to run in local environment...');

// the argument index for the source file path of running script
const ARGV_PROCESS_RUNNING_SCRIPT = 2;
// the argument index for the source file path of event json
const ARGV_PROCESS_EVENT_JSON = 3;
// the argument index for the source file path where this script loads environment variable from
const ARGV_PROCESS_ENV_SCRIPT = 4;
var fs = require('fs');

var event = null,
    context = {},
    callback = function(context, response) { // eslint-disable-line no-shadow
        console.log('handle callback is called with:', response, context);
    };

// run the script to load process.env if the command line argument is specified.
if (process.argv[ARGV_PROCESS_ENV_SCRIPT] !== undefined) {
    require(require.resolve(`${process.cwd()}/${process.argv[ARGV_PROCESS_ENV_SCRIPT]}`));
}

// if provided an event json file, use is. otherwise, use an empty event.
if (process.argv[ARGV_PROCESS_EVENT_JSON] !== undefined &&
    fs.existsSync(process.argv[ARGV_PROCESS_EVENT_JSON])) {
    const data = fs.readFileSync(process.argv[ARGV_PROCESS_EVENT_JSON]);
    try {
        event = JSON.parse(data);
    } catch (e) {
        throw e;
    }
}
// load entry script with an event
try {
    var entryScript = require(require.resolve(
        `${__dirname}/${process.argv[ARGV_PROCESS_RUNNING_SCRIPT]}`));
    entryScript.handler.call(null, event, context, callback);
} catch (error) {
    console.log(error);
    console.log('no specified script to run.\n' +
        'Please use format: node local <script> <event_script> <environment_script>');
}
