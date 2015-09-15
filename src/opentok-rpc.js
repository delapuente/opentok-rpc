
(function (opentok) {
  'use strict';

  var EXPOSE_ERROR = 'expose() must be passed with a function or a ' +
                     'hash of functions.';

  var CALL_ERROR = 'call() must be passed with the name of the ' +
                   'remote function.';

  var log = rpcLog('log');
  var warn = rpcLog('warn');
  var error = rpcLog('error');

  function rpcLog(level) {
    return function (id) {
      var msg = '[RPC#' + id + ']';
      var args = Array.prototype.slice.call(arguments, 1);
      args.unshift(msg);
      console[level].apply(console, args);
    };
  }

  function RPCEnabler(session) {
    this._session = session;
    this._rpcRegistry = Object.create(null);
    this._config = getDefaultConfiguration();
    this._session.on('signal:rpc', this._handleSignal.bind(this));
  }

  RPCEnabler.prototype = {
    constructor: RPCEnabler,

    expose: function (resolver) {
      if (typeof(resolver) === 'function') {
        this._getImplementation = resolver;
      }
      else if (typeof(resolver.getImplementation) !== 'undefined') {
        this._getImplementation = resolver.getImplementation.bind(resolver);
      }
      else if (typeof(resolver) === 'object') {
        this._getImplementation = getDefaultResolver(resolver);
      }
      else {
        throw new Error(EXPOSE_ERROR);
      }
    },

    call: function () {
      var args = getCallArguments(arguments);
      var config = extend(this._config, args.config);
      var name = args.name;
      var params = args.params;

      return this._call(config, name, params);
    },

    configure: function (newConfig) {
      this._config = extend(this._config, newConfig);
    },

    _call: function (config, name, args) {
      var id = getUniqueId(name);
      if (config.debug) { log(id, 'Calling `' + name + '` with', args); }

      var signal = buildSignal(config, name, id, args);
      var session = this._session;
      var rpcRegistry = this._rpcRegistry;

      return new Promise(function (fulfill, reject) {

        fulfill = getBoundResolver(rpcRegistry, id, fulfill);
        reject = getBoundResolver(rpcRegistry, id, reject);

        rpcRegistry[id] = { fulfill: fulfill, reject: reject};
        session.signal(
          signal,
          getSendingError(config.debug, reject, name)
        );

        if (config.timeout > 0) {
          setTimeout(() => reject('timeout'), config.timeout * 1000);
        }
      });
    },

    _handleSignal: function (event) {
      var from = event.from;
      if (from.id !== this._session.connection.id) {
        var data = JSON.parse(event.data);
        var id = data.id;
        var name = data.name;
        var config = data.config;
        var isResponse = data.isResponse;

        if (config.debug) {
          log(id, 'Receiving `' + name + '` ' +
                   (isResponse ? 'response.' : 'call.'));
        }

        var args = data.args;
        var config = data.config;

        if (isResponse) {
          this._accept(config, id, data.reason, data.result);
        }
        else {
          var doReturn = this._return.bind(this, config, from, name, id);
          var doThrow = this._throw.bind(this, config, from, name, id);
          this._do(config.debug, name, id, args).then(doReturn).catch(doThrow);
        }
      }
    },

    _accept: function (config, id, reason, result) {
      var rpc = this._rpcRegistry[id];
      var debug = config.debug;
      if (config.debug) { logResolve(rpc, id, reason, result); }

      if (rpc !== 'done') {
        if (!rpc.reject || !rpc.fulfill) {
          var msg = 'Invalid RPC record.';
          error(id, msg);
          throw new Error(msg);
        }

        if (reason) { rpc.reject(reason); }
        else { rpc.fulfill(result); }
      }
    },

    _do: function (debug, name, id, args) {
      var result;
      var implementation = this._getImplementation(name, args);

      if (!implementation) {
        var msg = 'No implementation for `' + name + '`';
        if (debug) { error(msg); }
        return Promise.reject(msg);
      }

      try {
        if (debug) { log(id, 'Executing RPC:', implementation); }
        result = implementation.apply(undefined, args);
      }
      catch (reason) {
        return Promise.reject(reason.message);
      }

      if (!result || typeof(result.then) !== 'function') {
        result = Promise.resolve(result);
      }
      return result;
    },

    _return: function (config, from, name, id, returnValue) {
      if (config.debug) { log(id, 'Sending response:', returnValue); }
      var signal = buildResponseSignal(config, from, name, id, returnValue);
      this._signalOrFail(signal);
    },

    _throw: function (config, from, name, id, reason) {
      if (config.debug) { log(id, 'Sending error:', reason); }
      var signal = buildErrorResponseSignal(config, from, name, id, reason);
      this._signalOrFail(signal);
    },

    _signalOrFail: function (signal) {
      this._session.signal(signal, function (reason) {
        if (reason) {
          throw new Error(reason);
        }
      });
    }
  };

  function getBoundResolver(container, id, resolver) {
    return function (value) {
      container[id] = 'done';
      return resolver(value);
    };
  }

  function logResolve(rpc, id, reason, result) {
    if (!rpc) {
      warn(id, 'No RPC with such id.');
    }
    else if (rpc === 'done') {
      warn(id, 'RPC already resolved. Ignoring.');
    }
    else {
      if (reason) { error(id, 'Rejecting RPC with:', reason); }
      else { log(id, 'Resolving RPC with:', result); }
    }
  }

  function getSendingError(debug, reject, name) {
    return function (reason) {
      if (reason) {
        if (debug) {
          error('Error sending `' + name + '`: ' + reason.message);
        }
        reject(reason);
      }
    };
  }

  function getDefaultResolver(resolver) {
    return function defaultResolver(name) {
      return resolver[name];
    };
  }

  function getCallArguments(args) {
    var candidate = args[0];
    var type = typeof(candidate);

    if (type === 'string') {
      return {
        config: {},
        name: candidate,
        params: Array.prototype.slice.call(args, 1)
      };
    }

    var name = args[1];
    if (type === 'object' && typeof(name) === 'string') {
      return {
        config: candidate,
        name: name,
        params: Array.prototype.slice.call(args, 2)
      };
    }

    throw new Error(CALL_ERROR);
  }

  function getDefaultConfiguration() {
    return {
      debug: false,

      timeout: 0,

      to: 'all'
    };
  }

  function extend() {
    return Array.prototype.reduce.call(arguments, function (union, obj) {
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          union[key] = obj[key];
        }
      }
      return union;
    }, {});
  }

  function buildSignal(config, name, id, args) {
    var signal = {};
    if (config.to !== 'all') { signal.to = config.to; }
    signal.type = 'rpc';
    signal.data = JSON.stringify({
      id: id,
      name: name,
      args: args,
      config: {
        debug: config.debug,
        timeout: config.timeout
      }
    });
    return signal;
  }

  function buildResponseSignal(config, from, name, id, data, isError) {
    var signal = {
      to: from,
      type: 'rpc',
      data: JSON.stringify({
        id: id,
        config: config,
        name: name,
        reason: isError ? data : undefined,
        result: !isError ? data : undefined,
        isResponse: true
      })
    };
    return signal;
  }

  function buildErrorResponseSignal(config, from, name, id, data) {
    return buildResponseSignal(config, from, name, id, data, true);
  }

  var promiseId = 0;

  function getUniqueId(name) {
    return 'promise-' + name + (++promiseId);
  }

  var Session = opentok.Session;

  Object.defineProperty(Session.prototype, 'rpc', { get: function () {
    var rpc = new RPCEnabler(this);
    Object.defineProperty(this, 'rpc', { value: rpc  });
    return rpc;
  }});
}(OT))
