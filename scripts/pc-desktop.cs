// LUTHUR desktop control helper (one per control session). Started by src/lib/desktop-control.ts; reads one JSON command per
// line on stdin and answers one JSON line on stdout. Shows an always-on-top bar while it runs: "LUTHUR has control" + Stop,
// and Allow/Deny when the server asks the owner to approve an app. Closing the bar or Stop ends the session.
// Build: csc /target:winexe /out:pc-desktop.exe pc-desktop.cs (see docs/DESKTOP-CONTROL.md for references).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

class PcDesktop {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  const uint LDOWN = 2, LUP = 4, RDOWN = 8, RUP = 16, WHEEL = 0x800;

  static readonly object outLock = new object();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
  static Bar bar;
  static void Emit(object o) { lock (outLock) { Console.Out.WriteLine(json.Serialize(o)); Console.Out.Flush(); } }

  static Dictionary<string, object> Win(IntPtr h) {
    var d = new Dictionary<string, object> { { "process", "" }, { "title", "" } };
    if (h == IntPtr.Zero) return d;
    uint pid; GetWindowThreadProcessId(h, out pid);
    try { d["process"] = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
    var sb = new StringBuilder(300); GetWindowText(h, sb, 300); d["title"] = sb.ToString();
    return d;
  }
  static Dictionary<string, object> AtPoint(int x, int y) { return Win(GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2)); }

  static object Shot(int maxW) {
    var b = Screen.PrimaryScreen.Bounds;
    using (var full = new Bitmap(b.Width, b.Height)) {
      using (var g = Graphics.FromImage(full)) g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size);
      double scale = Math.Min(1.0, (double)maxW / b.Width);
      int w = (int)(b.Width * scale), h = (int)(b.Height * scale);
      using (var small = new Bitmap(full, new Size(w, h)))
      using (var ms = new MemoryStream()) {
        var enc = ImageCodecInfo.GetImageEncoders().First(e => e.MimeType == "image/jpeg");
        var p = new EncoderParameters(1); p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L);
        small.Save(ms, enc, p);
        return new Dictionary<string, object> { { "ok", true }, { "img", Convert.ToBase64String(ms.ToArray()) }, { "w", w }, { "h", h }, { "scale", scale }, { "foreground", Win(GetForegroundWindow()) } };
      }
    }
  }
  static bool FocusedIsPassword() {
    try { var f = AutomationElement.FocusedElement; return f != null && f.Current.IsPassword; } catch { return false; }
  }
  // SendKeys treats + ^ % ~ ( ) { } [ ] as commands: escape them so text is typed literally.
  static string Literal(string s) {
    var sb = new StringBuilder();
    foreach (var c in s) { if ("+^%~(){}[]".IndexOf(c) >= 0) sb.Append('{').Append(c).Append('}'); else if (c == '\n') sb.Append("{ENTER}"); else if (c != '\r') sb.Append(c); }
    return sb.ToString();
  }
  static readonly Dictionary<string, string> Keys = new Dictionary<string, string> {
    { "enter", "{ENTER}" }, { "tab", "{TAB}" }, { "escape", "{ESC}" }, { "backspace", "{BACKSPACE}" }, { "delete", "{DELETE}" },
    { "up", "{UP}" }, { "down", "{DOWN}" }, { "left", "{LEFT}" }, { "right", "{RIGHT}" }, { "home", "{HOME}" }, { "end", "{END}" },
    { "pageup", "{PGUP}" }, { "pagedown", "{PGDN}" }, { "ctrl+a", "^a" }, { "ctrl+c", "^c" }, { "ctrl+v", "^v" }, { "ctrl+x", "^x" },
    { "ctrl+z", "^z" }, { "ctrl+s", "^s" }, { "ctrl+f", "^f" }, { "ctrl+n", "^n" }, { "ctrl+t", "^t" }, { "ctrl+w", "^w" }, { "alt+tab", "%{TAB}" }, { "f5", "{F5}" },
  };

  static object Run(Dictionary<string, object> c) {
    string cmd = c.ContainsKey("cmd") ? Convert.ToString(c["cmd"]) : "";
    Func<string, int> I = k => c.ContainsKey(k) ? Convert.ToInt32(c[k]) : 0;
    switch (cmd) {
      case "screenshot": return Shot(c.ContainsKey("maxW") ? I("maxW") : 1280);
      case "probe": return new Dictionary<string, object> { { "ok", true }, { "at", AtPoint(I("x"), I("y")) }, { "foreground", Win(GetForegroundWindow()) }, { "password", FocusedIsPassword() } };
      case "click": {
        SetCursorPos(I("x"), I("y")); Thread.Sleep(40);
        bool right = c.ContainsKey("right") && (bool)c["right"]; int n = c.ContainsKey("double") && (bool)c["double"] ? 2 : 1;
        for (int i = 0; i < n; i++) { mouse_event(right ? RDOWN : LDOWN, 0, 0, 0, UIntPtr.Zero); mouse_event(right ? RUP : LUP, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(60); }
        return new Dictionary<string, object> { { "ok", true } };
      }
      case "scroll": SetCursorPos(I("x"), I("y")); mouse_event(WHEEL, 0, 0, I("dy"), UIntPtr.Zero); return new Dictionary<string, object> { { "ok", true } };
      case "type": {
        if (FocusedIsPassword()) return new Dictionary<string, object> { { "ok", false }, { "error", "password" } };
        SendKeys.SendWait(Literal(Convert.ToString(c["text"]))); return new Dictionary<string, object> { { "ok", true } };
      }
      case "key": {
        string k = Convert.ToString(c["key"]).ToLowerInvariant();
        if (!Keys.ContainsKey(k)) return new Dictionary<string, object> { { "ok", false }, { "error", "key" } };
        SendKeys.SendWait(Keys[k]); return new Dictionary<string, object> { { "ok", true } };
      }
      case "ask": bar.Ask(Convert.ToString(c["app"])); return new Dictionary<string, object> { { "ok", true } };
      case "status": bar.Status(Convert.ToString(c["text"])); return new Dictionary<string, object> { { "ok", true } };
      case "quit": bar.Close(); return new Dictionary<string, object> { { "ok", true } };
      default: return new Dictionary<string, object> { { "ok", false }, { "error", "unknown" } };
    }
  }

  [STAThread]
  static int Main(string[] args) {
    SetProcessDPIAware();
    if (args.Length > 0 && args[0] == "--check") { Console.WriteLine("pc-desktop ok " + Screen.PrimaryScreen.Bounds.Size); return 0; }
    Application.EnableVisualStyles();
    bar = new Bar();
    var reader = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        object result; string id = "";
        try { var c = json.Deserialize<Dictionary<string, object>>(line); id = c.ContainsKey("id") ? Convert.ToString(c["id"]) : ""; result = bar.Invoke(new Func<object>(() => Run(c))); }
        catch (Exception e) { result = new Dictionary<string, object> { { "ok", false }, { "error", e.Message } }; }
        var r = result as Dictionary<string, object>; if (r != null) r["id"] = id; Emit(result);
      }
      try { bar.Invoke(new Action(() => bar.Close())); } catch { }
    }) { IsBackground = true };
    bar.Load += (s, e) => reader.Start();
    Application.Run(bar);
    Emit(new Dictionary<string, object> { { "event", "closed" } });
    return 0;
  }

  class Bar : Form {
    readonly Label label = new Label(); readonly Button stop = new Button(), allow = new Button(), deny = new Button(); string asking = "";
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x80; return p; } } // no-activate, tool window
    public Bar() {
      FormBorderStyle = FormBorderStyle.None; TopMost = true; ShowInTaskbar = false; BackColor = Color.FromArgb(18, 22, 34); Opacity = 0.94;
      Width = 560; Height = 40; StartPosition = FormStartPosition.Manual;
      var area = Screen.PrimaryScreen.WorkingArea; Left = area.Left + (area.Width - Width) / 2; Top = area.Top + 6;
      label.ForeColor = Color.FromArgb(120, 230, 255); label.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold); label.AutoSize = false;
      label.SetBounds(12, 0, 330, 40); label.TextAlign = ContentAlignment.MiddleLeft; label.Text = "● LUTHUR has control of this PC";
      foreach (var b in new[] { stop, allow, deny }) { b.FlatStyle = FlatStyle.Flat; b.ForeColor = Color.White; b.Font = new Font("Segoe UI", 9f, FontStyle.Bold); b.Height = 28; b.Top = 6; Controls.Add(b); }
      stop.Text = "■ Stop"; stop.BackColor = Color.FromArgb(190, 40, 50); stop.SetBounds(470, 6, 80, 28);
      allow.Text = "Allow"; allow.BackColor = Color.FromArgb(30, 130, 80); allow.SetBounds(300, 6, 76, 28); allow.Visible = false;
      deny.Text = "Deny"; deny.BackColor = Color.FromArgb(70, 70, 90); deny.SetBounds(382, 6, 76, 28); deny.Visible = false;
      stop.Click += (s, e) => { Emit(new Dictionary<string, object> { { "event", "stop" } }); Close(); };
      allow.Click += (s, e) => Answer(true); deny.Click += (s, e) => Answer(false);
      Controls.Add(label);
    }
    public void Ask(string app) { asking = app; label.Width = 286; label.Text = "Allow LUTHUR to use " + app + "?"; allow.Visible = deny.Visible = true; }
    public void Status(string text) { if (asking == "") label.Text = "● " + text; }
    void Answer(bool yes) {
      Emit(new Dictionary<string, object> { { "event", yes ? "allow" : "deny" }, { "app", asking } });
      asking = ""; allow.Visible = deny.Visible = false; label.Width = 330; label.Text = "● LUTHUR has control of this PC";
    }
  }
}
