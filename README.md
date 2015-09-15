# OpenTok RPC
OpenTok RPC adds Remote (promise-based) Procedure Call to the OpenTok library. So you can do:

```js
session.rpc.expose({
  multiply: function (a, b) { return a * b; }
});
```

And in the other end, you can call `multiply` by doing:

```js
session.rpc.call('multiply', 6, 7).then(function (result) {
  console.log('The Answer to the Ultimate Question of Life, The Universe, and Everything:', result);
});
```

## Installation
Just include the library just after adding the OpenTok library. OpenTok RPC will modify the base library to add all the required components.

## Usage
To perform RPC you need a way to expose those functions you want to call remotely and some way to call them.

### Exposing functions
When exposing functions for RPC you use `session.rpc.expose()` passing a map with the functions you want to expose on RPC.

For more advanced functionallity like creating remote procedures dynamically, you can pass a function or an object with a `getImplementation()` method. Either way, this function or method will be called with the name and parameters from the remote call. The returning value must be the function to be called.

### Calling RPC functions
If you want to call a remote procedure, you use `session.rpc()` passing the name of the remote function as the first parameter and its arguments.

When performing RPC, you broadcast the call to any client in the OpenTok room. If you want to limit the call to one specific connection, use:

```js
session.rpc({ to: connection }, 'multiply', 6, 7).then(function (result) {
  console.log('The meaning of life, Universe and everything else:', result);
});
```

When broadcasting, the promise will be resolved with the first answer (even if this is an error) and won't be resolved again even if another answer is received from another client.

#### Timeout
When performing RPC, you can wait infinitely for the answer or limit the number of seconds waiting before failing using:

```js
session.rpc({ timeout: 2 }, 'multiply', 6, 7).then(function (result) {
  console.log('The Answer to the Ultimate Question of Life, The Universe, and Everything:', result);
});
```

## Configuration
Any RPC can be configured passing a [_configuration object_](#configuration-object) as the first argument instead of the name of the function but you can globally configure RPC using `session.rpc.configure()` and passing a configuration object as well.

### Configuration object
A configuration object can be used to configure specific or global options for RPC. It supports the following options:

#### to
Accepts an OpenTok connection or `all`. Specify this to restrict the invocation of all functions.

#### timeout
The time in seconds to wait before rejecting with a `'timeout'` error.

#### debug
If set to `true` logs information related with RPC.
