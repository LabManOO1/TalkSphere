import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Home from "./pages/Home/Home";
import Login from "./pages/Login/Login";
import Register from "./pages/Register/Register";
import Meetings from "./pages/Meetings/Meetings";
import JoinMeeting from "./pages/JoinMeeting/JoinMeeting";
import Conference from "./pages/Conference/Conference";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/meetings" element={<Meetings />} />
          <Route path="/meetings/join" element={<JoinMeeting />} />
          <Route path="/conference/:inviteCode" element={<Conference />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
