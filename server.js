// Global Vars

var config = null;

// Modules

var readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
});
var fs = require("fs");
var request = require("request");
var querystring = require("querystring");
var jsdom = require("jsdom");
var rdio = null;

// Start

setup();

function setup() {
    
    readConfig();

    // rdio and echonest setup run in parallel
    var configChanged = false;
    var toFinish = 2;
    function finished() {
        toFinish--;
        if (!toFinish) {
            updateConfig();
        }
    }


    function readConfig() {
        fs.readFile("config.json", "utf8", function (err, data) {
            if (err) {
                throw err;
            }
            config = JSON.parse(data);
            
            rdioModuleConfig();
            tasteProfile();
        });
    }

    function updateConfig() {
        if (configChanged) {
	        fs.writeFile("config.json", JSON.stringify(config, null, "\t"), function (err) {
                if (err) {
                    throw ["config.json could not be updated.", err];
                }
                console.log("config.json updated.");
                match();
            });
        } else {
            match();
        }
    }

    function rdioModuleConfig() {
        rdio = require("rdio")({
            "rdio_api_key": config.rdioAPIKey,
            "rdio_api_shared": config.rdioAPIShared,
            "callback_url": "oob"
        });
        rdioAccess();
    }

    function rdioAccess() {
        // get access to rdio
        if (!config.rdioAccess) {
            getRdioAccess(function (rdioAccess) {
                config.rdioAccess = rdioAccess;
                configChanged = true;
                playlist();
            });
        } else {
            playlist();
        }
    }

    function playlist() {
        if (!config.playlistKey) {
            createEmptyPlaylist(config.playlistName,
                                "", // Playlist description
                                function (playlistKey) {
                                    config.playlistKey = playlistKey;
                                    configChanged = true;
                                    finished();
                                });
        } else {
            finished();
        }
    }

    function tasteProfile() {
        if (!config.tasteProfileID) {
            createTasteProfile(config.tasteProfileName, function (tasteProfileID) {
                config.tasteProfileID = tasteProfileID;
                configChanged = true;
                finished();
            });
        } else {
            finished();
        }
    }

    
    
}

function match() {

    jsdom.env({
        url: "https://www.apple.com/de/itunes/charts/songs/", // should also work with other countried
        scripts: ["http://code.jquery.com/jquery.js"],
        done: function (errors, window) {
            var $ = window.$;

            var songs = [];
            function Song(name, artist) {
                this.song_name = name;
                this.artist_name = artist;
            }
            $("#main .chart-grid .section-content ul li").each(function() {
                songs.push(new Song($("h3 a", this).text(),
                                    $("h4 a", this).text()));
            });

            var uniqSongs = uniq(songs);
            updateTasteProfileOrdered(config.tasteProfileID, uniqSongs, function () {
                readOrderedRdioKeysFromTasteProfile(config.tasteProfileID,
                                             function (rdioKeys) {
                                                 updatePlaylist(config.playlistKey, rdioKeys, function () {
                                                     process.exit(0);
                                                 });
                                             });
            });

            function uniq(a) {
                var seen = {};
                return a.filter(function(item) {
                    var itemString = JSON.stringify(item);
                    return seen.hasOwnProperty(itemString) ? false : (seen[itemString] = true);
                });
            }
        }
    });
    
}

// Functions

function getRdioAccess(callback) {
    rdio.getRequestToken(function (error, 
                                   oauthToken, 
                                   oauthTokenSecret, 
                                   results) {
        console.log("Please open: https://www.rdio.com/oauth/authorize?oauth_token="
                    + oauthToken + 
                    " and allow the app to access your account. Enter the shown PIN below.");
        readline.question("PIN: ", function(oauthVerifier) {
            rdio.getAccessToken(oauthToken,
                                oauthTokenSecret, 
                                oauthVerifier,
                                function (error, oauthToken, oauthTokenSecret, results) {
                                    var rdioAccess = {
                                        "oauthToken": oauthToken,
                                        "oauthTokenSecret": oauthTokenSecret
                                    };
                                    callback(rdioAccess);
                                });
        });
    });
}

function createTasteProfile(name, callback) {
    echonestPOSTAPIRequest("tasteprofile/create", {
        "type": "song",
        "name": name
    }, function (res) {
        if (res.response.status.code == 5) {
            callback(res.response.status.id);
        } else {
	        callback(res.response.id);
        }
    });
}

//// Match

function updateTasteProfileOrdered(tasteProfileID, songs, callback) {
    readTasteProfile(tasteProfileID, function (oldSongs) {
        emptyTasteProfile(tasteProfileID, oldSongs, function (emptyTicket) {
	        onTicketFinish(emptyTicket, function () {
		        fillTasteProfileOrdered(tasteProfileID, songs, function (fillTicket) {
			        onTicketFinish(fillTicket, callback);
		        });
	        });
        });
    });
	
    function readTasteProfile(tasteProfileID, callback, items, iteration) {
	    var chunkSize = 300; // don't waste requests (limited to 20 calls / minute)

	    if (items === undefined && iteration === undefined) {
		    items = [];
		    iteration = 0;
	    } else {
		    iteration++;
	    }
	    
        echonestGETAPIRequest("tasteprofile/read", {
            "id": tasteProfileID,
	        "start": iteration * chunkSize,
	        "results": chunkSize
        }, function (res) {
	        var total = res.response.catalog.total;
	        var receivedItems = res.response.catalog.items;
	        var allItems = items.concat(receivedItems);
	        if (allItems.length == total) callback(allItems);
	        else readTasteProfile(tasteProfileID, callback, allItems, iteration);
        });
    }

    function emptyTasteProfile(tasteProfileID, items, callback) {
        var data = [];
        for (var i in items) {
            var item = items[i];
            if (item.song_id !== undefined) {
                data.push({
                    "action": "delete",
                    "item": {
                        "song_id": item.song_id
                    }
                });
            }
        }
        
        echonestPOSTAPIRequest("tasteprofile/update", {
            "id": tasteProfileID,
            "data": JSON.stringify(data)
        }, function (res) {
            callback(res.response.ticket);
        });
    }
    
    function fillTasteProfileOrdered(tasteProfileID, songs, callback) {
        
        var data = [];
        for (var i in songs) {
            songs[i].item_keyvalues = {
                "index": i
            };
            data.push({
                "action": "update",
                "item": songs[i]
            });
        }
        echonestPOSTAPIRequest("tasteprofile/update", {
            "id": tasteProfileID,
            "data": JSON.stringify(data)
        }, function (res) {
            callback(res.response.ticket);
        });
    }

    function onTicketFinish(ticket, callback) {
        var delay = 1000; // delay between checks
        
        echonestGETAPIRequest("tasteprofile/status", {
            "ticket": ticket
        }, function (res) {
            
            var status = res.response.ticket_status;
            if (status == "complete") {
                callback(res);
            } else if (status == "pending") {
                setTimeout(function () {
                    onTicketFinish(ticket, callback);
                }, delay);
            } else {
                throw "unexpected ticker status: "+ status;
            }
        });
    }
}

function readOrderedRdioKeysFromTasteProfile(tasteProfileID, callback, items, iteration) {
	var chunkSize = 300; // don't waste requests (limited to 20 calls / minute)
	
	if (items === undefined && iteration === undefined) {
		items = [];
		iteration = 0;
	} else {
		iteration++;
	}
	
    echonestGETAPIRequest("tasteprofile/read", {
        "id": tasteProfileID,
	    "start": iteration * chunkSize,
	    "results": chunkSize,
        "bucket": ["id:rdio-DE",
                   "tracks",
                   "item_keyvalues"]
    }, function (res) {
	    var total = res.response.catalog.total;
	    var receivedItems = res.response.catalog.items;
	    var allItems = items.concat(receivedItems);
	    if (allItems.length == total) callback(extractKeys(allItems));
	    else readOrderedRdioKeysFromTasteProfile(tasteProfileID, callback, allItems, iteration);
    });

    function extractKeys(items) {
	    return items
            .sort(function (a, b) {
                return a.item_keyvalues.index - b.item_keyvalues.index;
            })
            .map(function (item) {
                var tracks = item.tracks;
                if (tracks !== undefined && tracks.length) {
                    // TODO: automaticly choose release of track that is available in region
                    return tracks[0].foreign_id.split(":")[2];
                }
                return null;
            })
            .filter(function (item) {
                if (item === null) return false;
                else return true;
            });
	    
    }
}

function createEmptyPlaylist(name, description, callback) {
    rdioAPIRequest({
        "method": "createPlaylist",
        "name": name,
        "description": description,
        "tracks": ""
    }, function (err, data, response) {
        callback(data.result.key);
    });
}

function updatePlaylist(key, tracks, callback) {

    getCurrentTracks(key, function (oldTracks) {
        emptyPlaylist(key, oldTracks, function () {
            refillPlaylist(key, tracks, function () {
                callback();
            });
        });
    });

    function getCurrentTracks(key, callback) {
        rdioAPIRequest({
            "method": "getPlaylists",
            "extras": "trackKeys"
        }, function (err, data, res) {
            var playlists = data.result.owned;
            var exists = false;
            for (var i in playlists) {
                var playlist = playlists[i];
                if (playlist.key == key) {
                    var oldTracks = playlist.trackKeys;
                    callback(oldTracks);
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                throw "Playlist with key not found.";
            }
        });
    }

    function emptyPlaylist(key, oldTracks, callback) {
        rdioAPIRequest({
            "method": "removeFromPlaylist",
            "playlist": key,
            "index": "0", // workaround, rdio returns 401 if 0 is passed as
            // number (is problem in oauth lib)
            "count": oldTracks.length,
            "tracks": oldTracks
        }, function (err, data, res) {
            callback(data.result);
        });
    }

    function refillPlaylist(key, tracks, callback) {
        rdioAPIRequest({
            "method": "addToPlaylist",
            "playlist": key,
            "tracks": tracks
        }, function (err, data, res) {
            callback(data.result);
        });
    }
}

function deletePlaylist(key, callback) {
    rdioAPIRequest({
        "method": "deletePlaylist",
        "playlist": key
    }, function (err, data, res) {
        console.log(err, data);
        
    });
}


// Helpers

//// echonest

function echonestGETAPIRequest(path, params, callback) {
    params.api_key = config.echonestAPIKey;

    request.get({
        url: "http://developer.echonest.com/api/v4/"+ path +"?"+ querystring.stringify(params)
    }, function (err, httpResponse, body) {
        callback(JSON.parse(body));
    });
}

function echonestPOSTAPIRequest(path, data, callback) {
    data.api_key = config.echonestAPIKey;
    
    request.post({
        url: "http://developer.echonest.com/api/v4/"+ path, 
        form: data
    }, function (err, httpResponse, bodyString) {
        var body = JSON.parse(bodyString);
        if (body.response.status.code !== 0) {
            console.error(path, data, bodyString);
        }
        callback(body);
    });
}

//// rdio

function rdioAPIRequest(payload, callback) {
    rdio.api(config.rdioAccess.oauthToken,
             config.rdioAccess.oauthTokenSecret,
             payload,
             function (err, data, response) {
                 if (!err) {
                     data = JSON.parse(data);
                 }
                 callback(err, data, response);
             });
}



