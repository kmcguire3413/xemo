const fs = require('fs');

/*
    This is the notification table. For each time
    specified on the left the time specified on the
    right is when a notification will happen for that
    time on the left. The value on the right has two
    parts. It has a time and a day offset which represents 
    the numbers of days prior.

    For 01:24 the notification time would be 08:24 the
    previous day. For 00:45 the notification time would be
    08:00 the previous day.
*/
var ntbl = {
    0:  [8, 1],
    1:  [8, 1],
    2:  [8, 1],
    3:  [8, 1],
    4:  [8, 1],
    5:  [8, 1],
    6:  [8, 1],
    7:  [8, 1],
    8:  [8, 1],
    9:  [9, 1],
    10: [10, 1],
    11: [11, 1],
    12: [12, 1],
    13: [13, 1],
    14: [14, 1],
    15: [15, 1],
    16: [16, 1],
    17: [17, 1],
    18: [18, 1],
    19: [19, 1],
    20: [20, 1],
    21: [8, 0],
    22: [8, 0],
    23: [8, 0],
};

module.exports = {
    /*
        The base URL to access the root directory of the server.
    */
    baseurl:      'http://mydomain.net:1234/',

    https_key:     fs.readFileSync('/path/to/ssl.key'),
    https_cert:    fs.readFileSync('/path/to/ssl.cert'),
    https_ciphers: 'EECDH+AESGCM:EDH+AESGCM:ECDHE-RSA-AES128-GCM-SHA256:AES256+EECDH:DHE-RSA-AES128-GCM-SHA256:AES256+EDH:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA:ECDHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA256:DHE-RSA-AES128-SHA256:DHE-RSA-AES256-SHA:DHE-RSA-AES128-SHA:ECDHE-RSA-DES-CBC3-SHA:EDH-RSA-DES-CBC3-SHA:AES256-GCM-SHA384:AES128-GCM-SHA256:AES256-SHA256:AES128-SHA256:AES256-SHA:AES128-SHA:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!MD5:!PSK:!RC4',

    http_port:          1122,
    https_port:         1123,
    sync_with_old:      false,
    notify_for_groups:  {
    },

    /*
        The database configuration.
    */
    db: {
        //type:    'sqlite3',
        //path:    './data.db'
        type:     'mysql',
        host:     'localhost',
        dbname:   'database_name',
        user:     'database_user',
        pass:     'database_password'
    }
};