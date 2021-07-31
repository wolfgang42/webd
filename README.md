# `webd` - HTTP super-server
Sort of like inetd but for web services only.

Spins services up on demand and then proxies to them, shutting them down after they don't get any requests for a while.

Features:
* Zero dependencies outside of Node standard library
* `Host`-based routing
* Automatic startup and shutdown of backends

Bugs (patches gladly accepted!):
* Primitive error handling (dump a stack trace into the HTTP response)
* No support for HTTPS, on either end
* Probably doesn't handle things like websockets
* No logging support
* No test suite

## Usage
### Synopsis
```sh
./webd.js ./config.example.json
```

### Configuration
`webd.js` expects one argument, a `config.js` or `config.json` file (see `config.example.json`).

Config options:
* `listen` (required, object): Options for [`server.listen()`](https://nodejs.org/api/net.html#net_server_listen_options_callback).
* `backends` (required, object): Map of `Host` name to backend configurations with the following keys:
  * `connectionOptions` (required, object): Options for [`http.request()`](https://nodejs.org/api/http.html#http_http_request_url_options_callback). `host` defaults to "localhost" unless overridden.
  * `run` (optional, object): Options for starting the backend.
    * `cwd` (optional, string): directory to `cd` to before starting the command
    * `command` (required, string): command to run
    * `args` (required, string[]): arguments to pass to command (note that they must be split already unless you're using `shell`)
    * `shell` (optional, boolean): If `true`, `command` is passed to a shell; see [`child_process.spawn()`](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options) for details.
  * `shutdownAfter` (optional, number, milliseconds): How long to wait for another request before shutting down the backend. (If not specified, the backend will be started on the first request and will never be shut down.)
