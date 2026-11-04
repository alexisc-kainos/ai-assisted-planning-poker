import { Avatar } from './avatars';
import { Mascot } from './Mascot';
import { RoomPage } from './RoomPage';
import { generateRoomId, isValidRoomId, markCreator } from './room';

function Landing() {
  const createRoom = () => {
    const roomId = generateRoomId();
    markCreator(roomId);
    window.location.assign(`?room=${roomId}`);
  };

  return (
    <section className="card landing">
      <Mascot />
      <h2>Welcome to Planning Poker</h2>
      <p>Open a room, share the link, and estimate together.</p>
      <button type="button" className="primary" onClick={createRoom}>
        Create a room
      </button>
    </section>
  );
}

export function App() {
  const roomParam = new URLSearchParams(window.location.search).get('room');

  const validRoom = roomParam !== null && isValidRoomId(roomParam);

  let content;
  if (roomParam === null) {
    content = (
      <div className="narrow">
        <Landing />
      </div>
    );
  } else if (!isValidRoomId(roomParam)) {
    content = (
      <section className="card narrow">
        <p className="notice error" role="alert">
          This room link isn't valid. Check the link or create a new room.
        </p>
        <a href="?">Create a new room</a>
      </section>
    );
  } else {
    content = <RoomPage roomId={roomParam} />;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="brand">
            <Avatar id="capybara" size={32} />
            Planning Poker
          </h1>
          {validRoom && (
            <p className="room-code">
              Room <code>{roomParam}</code>
            </p>
          )}
        </div>
      </header>
      <main className="app">{content}</main>
    </>
  );
}
