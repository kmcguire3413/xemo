xemo.plugins.Console = function (tk, frame) {
    this.name = 'Console';
    this.prefix = tk.prefix + 'console__';
    this.frame = frame;
    $(this.frame).empty();

    this.buffer = [];

    this.log = document.createElement('pre');

    this.write('[console initialized]');

    $(this.frame).append('This component catches messages that are used to debug the system.');
    $(this.frame).append(this.log);    
    return this;
}

xemo.plugins.Console.prototype.init = function () {
    /*
        At the moment I do not have a dependency system and plugins
        expect that console is properly loaded. So I do all my work
        in the constructor, which is actually okay since I do not
        use the interface `tk`.
    */
}

xemo.plugins.Console.prototype.onshow = function () {
    // I had to do this to prevent the window from scrolling
    // as messages were added to the log. Now, they are only
    // rendered to screen when the plugin becomes visible.
    for (var x = 0; x < this.buffer.length; ++x) {
        $(this.log).append(this.buffer[x]);
    }
}

xemo.plugins.Console.prototype.onhide = function () {
    $(this.log).empty();
}

xemo.plugins.Console.prototype.write = function (msg) {
    this.buffer.push(msg + '<br/>');
}

xemo.plugins.Login = function (tk, frame) {
    this.name = 'Login';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();
    return this;
}

xemo.plugins.Login.prototype.init = function () {
    this.prefix = this.tk.prefix + 'login__';
    $(this.frame).empty();
    
    this.params = this.tk.getURLParameters();

    var halflogin;
    if (this.params.plug_login_half == 'true') {
        halflogin = true;
    } else {
        halflogin = false;
    }

    this.loginredirect = this.params.plug_login_redirect;

    var username = params.username;
    var password = params.password;
    var passhash = params.passhash;

    this.provided_passhash = passhash;

    this.tk.log('initialized');

    this.status = document.createElement('div');

    this.status.id = '{0}status'.format(this.prefix);

    $(this.frame).append(this.status);

    $(this.status).empty();
    $(this.status).append('Enter your login information to access the system.<br/><br/>');

    this.formcont = document.createElement('div');
    this.formlogout = document.createElement('div');
    $(this.formlogout).hide();

    this.username = document.createElement('input');
    this.password = document.createElement('input');
    this.userpwsubmit = document.createElement('input');

    this.userlogout = document.createElement('input');
    this.userlogout.type = 'submit';
    this.userlogout.value = 'Logout';
    this.userlogout.__loginobj = this;
    this.userlogout.onclick = function () {
        $(this.__loginobj.formcont).show();
        $(this.__loginobj.formlogout).hide();
        this.__loginobj.valid_username = undefined;
        this.__loginobj.valid_password = undefined;
        this.__loginobj.valid_passhash = undefined;
        window.location.href = 'index.html';
    }

    $(this.formlogout).append(this.userlogout);

    this.username.value = username || '';
    this.password.value = password || '';

    if (halflogin) {
        this.username.value = 'anybody';
        $(this.username).hide();
    }

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
        // Rebuild the URL with the passhash included.
        var url = [];
        for (k in this.__loginobj.params) {
            if (k == 'passhash') {
                // Do NOT include an old password hash.
                continue;
            }
            url.push(k + '=' + encodeURI(this.__loginobj.params[k]));
        }
        url.push('passhash=' + encodeURI(hash));
        window.location.href = 'index.html?' + url.join('&');
    }

    if (halflogin) {
        $(this.formcont).append(this.username, ' Password: ', this.password, ' ', this.userpwsubmit);
    } else {
        $(this.formcont).append('Username: ', this.username, ' Password: ', this.password, ' ', this.userpwsubmit);
    }
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
                cb(false, undefined, undefined, data['error']);
                return;
            }
            cb(true, data['id'], data['username'], undefined);
        });
    }

    //alert(CryptoJS.SHA512('hello world'));
    this.doVerify = function (hash) {
        // Go ahead do the login verification process.
        this.formcont.disabled = true;
        $(this.status).empty();
        $(this.status).append('Please wait while your information is validated..<br/><br/>');
        var status = this.status;
        if (hash == undefined) {
            alert('@@' + this.username.value + ':' + this.password.value);
            hash = CryptoJS.SHA512('{0}:{1}'.format(this.username.value, this.password.value));
        }
        var __obj = this;
        this.verify(hash, function (result, id, username, error_text) {
            $(status).empty();
            __obj.formcont.disabled = false;
            if (result) {
                $(status).append('You are successfully logged into the system.<br/><br/>');
                $(__obj.formcont).hide();
                $(__obj.formlogout).show();
                __obj.valid_username = __obj.username.value;
                __obj.valid_passhash = hash;
                if (__obj.loginredirect) {
                    // This is an adaptation of the system to still provide
                    // a login interface, but give the appearance of the old
                    // system. It could also be used for other purposes, but
                    // at the moment this is the reasoning.
                    __obj.tk.showPlugin(__obj.loginredirect);
                }
            } else {
                $(status).append('Your login has been rejected..<br/><br/>');
            }
        });
    };

    this.getAuthHash = function () {
        return this.valid_passhash || this.provided_passhash;
    }

    if (username != undefined && password != undefined) {
        this.doVerify();
    }

    if (passhash != undefined) {
        this.doVerify(passhash);
    }
}