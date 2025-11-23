import { Server } from "socket.io";
import "dotenv/config";

const origins = (process.env.ORIGIN ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const io = new Server({
  cors: {
    origin: origins
  }
});

const port = Number(process.env.PORT);

io.listen(port);
console.log(`Server is running on port ${port}`);

let peers: any = {};

io.on("connection", socket => {

  console.log("Nuevo cliente conectado:", socket.id);

  peers[socket.id] = socket.id;


  socket.on("webrtc:join", () => {
    socket.broadcast.emit("webrtc:ready");
  });

  socket.on("webrtc:offer", offer => {
    socket.broadcast.emit("webrtc:offer", offer);
  });

  socket.on("webrtc:answer", answer => {
    socket.broadcast.emit("webrtc:answer", answer);
  });

  socket.on("webrtc:candidate", candidate => {
    socket.broadcast.emit("webrtc:candidate", candidate);
  });



  socket.on("signal", (to, from, data) => {
    if (to in peers) {
      io.to(to).emit("signal", to, from, data);
    } else {
      console.log("Peer not found!");
    }
  });


  socket.on("disconnect", () => {
    delete peers[socket.id];
    io.sockets.emit("userDisconnected", socket.id);
    console.log(
      "Peer disconnected with ID",
      socket.id,
      ". There are " + io.engine.clientsCount + " peer(s) connected."
    );
  });

});
