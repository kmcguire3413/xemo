function plugin_Console(tk, frame) {

}

function plugin_Calendar(tk, frame) {

}

function plugin_Reports(tk, frame) {

}

function plugin_Login(tk, frame) {
    this.prefix = tk.prefix + 'login__';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();
    var params = GetURLParameters();
    var username = params.username;
    var password = params.password;
    var passhash = params.passhash;

    this.status = document.createElement('div');

    this.status.id = '{0}status'.format(this.prefix);

    $(this.frame).append(this.status);

    $(this.status).empty();
    $(this.status).append('Enter your login information to access the system.<br/><br/>');

    this.formcont = document.createElement('div');
    this.formlogout = document.createElement('div');
    this.formlogout.style.visibility = 'hidden';

    this.username = document.createElement('input');
    this.password = document.createElement('input');
    this.userpwsubmit = document.createElement('input');

    this.userlogout = document.createElement('input');
    this.userlogout.type = 'submit';
    this.userlogout.value = 'Logout';
    this.userlogout.__loginobj = this;
    this.userlogout.onclick = function () {
        this.__loginobj.formcont.style.visibility = 'visible';
        this.__loginobj.formlogout.style.visibility = 'hidden';
        this.__loginobj.valid_username = undefined;
        this.__loginobj.valid_password = undefined;
        this.__loginobj.valid_passhash = undefined;
        window.location.href = 'index.html';
    }

    $(this.formlogout).append(this.userlogout);

    this.username.value = username || '';
    this.password.value = password || '';

    this.username.className = 'ui';
    this.password.className = 'ui';
    this.userpwsubmit.className = 'ui';

    this.userpwsubmit.type = 'submit';
    this.userpwsubmit.value = 'Login';

    this.userpwsubmit.__loginobj = this;
    this.userpwsubmit.onclick = function () {
        // We need to reload the page with the hash for the username and password.
        // This helps people bookmark the page and saves their username and password.
        var hash = CryptoJS.SHA512('{0}:{1}'.format(
            this.__loginobj.username.value, 
            this.__loginobj.password.value
        ));
        window.location.href = 'index.html?passhash=' + hash;
    }

    $(this.formcont).append('Username: ', this.username, ' Password: ', this.password, ' ', this.userpwsubmit);
    $(this.frame).append(this.formcont);
    $(this.frame).append(this.formlogout);

    /*
    $(this.frame).append('\
        Username: <input class="ui" id="{0}username" type="input" value="{1}"/> \
        Password: <input class="ui" id="{0}password" type="input" value="{2}"/> \
        <input class="ui" type="submit" value="Verify"/><br/> \
    '.format(this.prefix, username, password));
    */

    this.verify = function (hash, cb) {
        $.get('v1api.py?key={0}&op=verify'.format(hash), function (data) {
            var data = $.parseJSON(data);
            if (data['code'] == 'error') {
                cb(false, undefined, undefined);
                return;
            }
            cb(true, data['id'], data['username']);
        });
    }

    //alert(CryptoJS.SHA512('hello world'));
    this.doverify = function (hash) {
        // Go ahead do the login verification process.
        this.formcont.disabled = true;
        $(this.status).empty();
        $(this.status).append('Please wait while your information is validated..<br/><br/>');
        var status = this.status;
        if (hash == undefined) {
            hash = CryptoJS.SHA512('{0}:{1}'.format(this.username.value, this.password.value));
        }
        var __obj = this;
        this.verify(hash, function (result, id, username) {
            $(status).empty();
            __obj.formcont.disabled = false;
            if (result) {
                $(status).append('You are successfully logged into the system.<br/><br/>');
                __obj.formcont.style.visibility = 'hidden';
                __obj.formlogout.style.visibility = 'visible';
                this.valid_username = __obj.username.value;
                this.valid_passhash = hash;
            } else {
                $(status).append('Your login has been rejected..<br/><br/>');
            }
        });
    };

    if (username != undefined && password != undefined) {
        this.doverify();
    }

    if (passhash != undefined) {
        this.doverify(passhash);
    }
}