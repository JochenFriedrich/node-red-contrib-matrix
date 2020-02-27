/**
 * Module dependencies.
 */

var matrixsdk = require("matrix-js-sdk");

module.exports = function(RED) {

    function MatrixServerNode(n) {
        RED.nodes.createNode(this,n);

        var node = this;

        node.server = n.server;
        node.token = n.token;
        node.userid = n.userid;
        node.room = n.room;

        node.matrixClient = matrixsdk.createClient({ baseUrl: node.server, accessToken: node.token, userId: node.userid });

        node.matrixClient.on("RoomMember.membership", function(event, member) {
            if (member.membership === "invite" && member.userId === node.userId) {
                node.log("Trying to join room " + member.roomId);
                node.matrixClient.joinRoom(member.roomId).then(function() {
                    node.log("Automatically accepted invitation to join room " + member.roomId);
                }).catch(function(e) {
                    node.warn("Cannot join room (probably because I was kicked) " + member.roomId + ": " + e);
                });
             }
        });

        node.matrixClient.on("sync", function(state, prevState, data) {
            switch (state) {
                case "ERROR":
                    // update UI to say "Connection Lost"
                    node.warn("Connection to Matrix server lost");
                    node.updateConnectionState(false);
                    break;
                case "SYNCING":
                    // update UI to remove any "Connection Lost" message
                    node.updateConnectionState(true);
                    break;
                case "PREPARED":
                    // the client instance is ready to be queried.
                    node.log("Synchronized to Matrix server.");
                    node.log("Getting rooms...");
                    var rooms=node.matrixClient.getRooms();
                    rooms.forEach(room=>{ console.log(room.roomId + " " + room.name);});
                    break;
             }
        });

        node.matrixClient.startClient();

        // Called when the connection state may have changed
        this.updateConnectionState = function(connected){
            if (node.connected !== connected) {
                node.connected = connected;
                if (connected) {
                    node.emit("connected");
                } else {
                    node.emit("disconnected");
                }
            }
        };

        // When Node-RED updates nodes, disconnect from server to ensure a clean start
        node.on("close", function (done) {
            node.log("Matrix configuration node closing...");
            if (node.matrixClient) {
                node.matrixClient.stopClient();
                node.updateConnectionState(false);
            }
            done();
        });
    }

    RED.nodes.registerType("matrix-server",MatrixServerNode);

    function MatrixInputNode(config) {
        RED.nodes.createNode(this,config);
        var node = this;

        node.configNode = RED.nodes.getNode(config.server);

        node.room = config.room;
        node.filterself = config.filterself;

        if (!node.configNode) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.configNode.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.configNode.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
            node.configNode.matrixClient.on("Room.timeline", function(event, room, toStartOfTimeline) {
                if (node.filterself && (!event.getSender() || event.getSender() === node.configNode.userid)) {
                    return; // ignore our own messages
                }

                if (node.room && (node.room !== room.roomId)) {
                    return;
                }

		if (event.event.type !== "org.nodered.msg") {
                    return;
                }

                var msg = event.getContent();
                node.send(msg);
            });
        });

        this.on("close", function(done) {
            done();
        });

    }
    RED.nodes.registerType("matrix-input",MatrixInputNode);

    function MatrixRecvTextNode(config) {
        RED.nodes.createNode(this,config);
        var node = this;

        node.configNode = RED.nodes.getNode(config.server);

        node.room = config.room;
        node.filterself = config.filterself;

        if (!node.configNode) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.configNode.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.configNode.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
            node.configNode.matrixClient.on("Room.timeline", function(event, room, toStartOfTimeline) {
                if (node.filterself && (!event.getSender() || event.getSender() === node.configNode.userid)) {
                    return; // ignore our own messages
                }

                if (node.room && (node.room !== room.roomId)) {
                    return;
                }

		if (event.event.type !== "m.room.message") {
                    return;
                }

                var msg = {
                    payload: event.getContent().body,
                    sender:  event.getSender(),
                    roomId:  room.roomId
                };

                node.send(msg);
            });
        });

        this.on("close", function(done) {
            done();
        });

    }
    RED.nodes.registerType("matrix-recvtext",MatrixRecvTextNode);

    function MatrixOutputNode(config) {
        RED.nodes.createNode(this,config);
        var node = this;

        node.room = config.room;

        node.configNode = RED.nodes.getNode(config.server);

        if (!node.configNode) {
            node.warn("No configuration node");
            return;
        }

        node.configNode.on("connected", function(){
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.configNode.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        this.on("input", function (msg) {
            if (! node.configNode || ! node.configNode.matrixClient) {
                node.warn("No configuration");
                return;
            }

            var destRoom = "";
            if (node.room) {
                destRoom = node.room;
            } else if (node.configNode.room) {
                destRoom = node.configNode.room;
            } else {
                node.warn("Room must be specified in configuration");
                return;
            }

            node.configNode.matrixClient.sendEvent(destRoom, "org.nodered.msg", msg, "")
                .then(function() { })
                .catch(function(e){ node.warn("Error sending message " + e); });
        });

        this.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("matrix-output", MatrixOutputNode);

    function MatrixSendTextNode(config) {
        RED.nodes.createNode(this,config);
        var node = this;

        node.room = config.room;
        node.notice = config.notice;

        node.configNode = RED.nodes.getNode(config.server);

        if (!node.configNode) {
            node.warn("No configuration node");
            return;
        }

        node.configNode.on("connected", function(){
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.configNode.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        this.on("input", function (msg) {
            if (! node.configNode || ! node.configNode.matrixClient) {
                node.warn("No configuration");
                return;
            }

            var destRoom = "";
            if (msg.roomId) {
                destRoom = msg.roomId;
            } else if (node.room) {
                destRoom = node.room;
            } else if (node.configNode.room) {
                destRoom = node.configNode.room;
            } else {
                node.warn("Room must be specified in configuration");
                return;
            }

            if (node.notice) {
                node.configNode.matrixClient.sendNotice(destRoom, msg.payload)
                    .then(function() { })
                    .catch(function(e){ node.warn("Error sending message " + e); });
            } else {
                node.configNode.matrixClient.sendTextMessage(destRoom, msg.payload)
                    .then(function() { })
                    .catch(function(e){ node.warn("Error sending message " + e); });
            }
        });

        this.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("matrix-sendtext", MatrixSendTextNode);
}
