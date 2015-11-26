var https = require('https');
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var core = require('./lib/core.js'); 
var moment = require('moment-timezone');
var twilio = require('twilio');
var domain = require('domain');
var dbjuggle = require('dbjuggle');
var uuid = require('uuid');
var xps = require('./lib/xps.js');



var xemo = {};


xemo.notify = {};

xemo.notify.start = function (cfg) {
    
};



xemo.notify.start(require(process.argv[2]));