# iTunes Charts rdio Mirror

Load German iTunes Charts into a rdio Playlist.

# Usage

Rename `config.json.default` to `config.json` and edit it to contain all
required values (here's where you can get API-Keys / shared secrets for
[rdio](http://rdio.mashery.com/member/register) and
[Echo Nest](http://developer.echonest.com/account/register)). Run `npm
install` to install all dependencies. Run the app with `node server.js`
and follow the instructions. A rdio playlist with the name defined in
`config.json` will be created. You can run the script again to update
the playlist if the iTunes Charts change. Use the same `config.json` as
on the first run.
