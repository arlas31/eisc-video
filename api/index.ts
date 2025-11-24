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

const port = Number(process.env.PORT ?? 9000);
io.listen(port);
console.log(`Signaling server running on port ${port}`);

// Configuración sencilla de control de acceso
const REQUIRE_TOKEN = (process.env.REQUIRE_TOKEN ?? "false") === "true";
const VIDEO_TOKEN = process.env.VIDEO_TOKEN ?? ""; // setear en .env si REQUIRE_TOKEN=true

// peersPorSala: { [room]: Set<socketId> }
const peersPorSala: Record<string, Set<string>> = {};

io.on("connection", socket => {
  console.log("Nuevo cliente conectado:", socket.id);

  // helper para quitar socket de todas las salas que tenía
  function removeFromAllRooms() {
    for (const room of Object.keys(peersPorSala)) {
      if (peersPorSala[room].has(socket.id)) {
        peersPorSala[room].delete(socket.id);
        // notificar a la sala que alguien se desconectó
        io.to(room).emit("userDisconnected", socket.id);
        if (peersPorSala[room].size === 0) {
          delete peersPorSala[room];
        }
      }
    }
  }

  socket.on("webrtc:join", (payload: { room?: string; token?: string; username?: string } = {}) => {
    const room = payload?.room ?? "default";
    const token = payload?.token;

    // Ignorar joins repetidos del mismo socket a la misma sala
    if (socket.data.room && socket.data.room === room) {
      // ya está en la sala solicitada, ignora
      return;
    }

    // Validar token si es requerido
    if (REQUIRE_TOKEN && VIDEO_TOKEN && token !== VIDEO_TOKEN) {
      socket.emit("webrtc:join:error", { message: "Token inválido" });
      console.log(`Socket ${socket.id} rechazado por token inválido`);
      return;
    }

    // crear room si no existe
    if (!peersPorSala[room]) peersPorSala[room] = new Set();

    // verificar límite de 2
    if (peersPorSala[room].size >= 2) {
      socket.emit("webrtc:join:error", { message: "Sala llena (máx 2)" });
      console.log(`Socket ${socket.id} rechazado: sala ${room} llena`);
      return;
    }

    // unir al room
    socket.join(room);
    peersPorSala[room].add(socket.id);
    socket.data.room = room;
    socket.data.username = payload?.username ?? socket.id;

    console.log(`Socket ${socket.id} se unió a ${room}. Miembros: ${peersPorSala[room].size}`);

    // notificar a los otros en la sala que pueden comenzar la negociación
    socket.to(room).emit("webrtc:ready", { from: socket.id, username: socket.data.username });

    // confirmar unión
    socket.emit("webrtc:joined", { room, id: socket.id });
  });

  // Señalización por sala: offer/answer/candidate
  socket.on("webrtc:offer", (payload: { room?: string; offer: any }) => {
    const room = payload?.room ?? socket.data.room;
    if (!room) return;
    socket.to(room).emit("webrtc:offer", { from: socket.id, offer: payload.offer });
  });

  socket.on("webrtc:answer", (payload: { room?: string; answer: any }) => {
    const room = payload?.room ?? socket.data.room;
    if (!room) return;
    socket.to(room).emit("webrtc:answer", { from: socket.id, answer: payload.answer });
  });

  socket.on("webrtc:candidate", (payload: { room?: string; candidate: any }) => {
    const room = payload?.room ?? socket.data.room;
    if (!room) return;
    socket.to(room).emit("webrtc:candidate", { from: socket.id, candidate: payload.candidate });
  });

  // Mensajes de chat por sala
  socket.on("chat:message", (payload: { room?: string; userId?: string; message?: string; timestamp?: string }) => {
    const room = payload?.room ?? socket.data.room;
    if (!room) return;
    // reenviar a la sala (incluye al emisor también si quieres)
    io.to(room).emit("chat:message", {
      userId: payload.userId ?? socket.data.username ?? socket.id,
      message: payload.message,
      timestamp: payload.timestamp ?? new Date().toISOString()
    });
  });

  // Señalización genérica (por id)
  socket.on("signal", (to: string, from: string, data: any) => {
    if (io.sockets.sockets.has(to)) {
      io.to(to).emit("signal", to, from, data);
    } else {
      console.log("Peer not found!", to);
    }
  });

  socket.on("disconnect", () => {
    removeFromAllRooms();
    console.log(
      "Peer disconnected with ID",
      socket.id,
      ". Clients connected:",
      io.engine.clientsCount
    );
  });
});