using System;
using System.Net;
using System.Threading;
using System.Speech.Recognition;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
class PcWake {
  static int Main(string[] args){
    try {
      bool check=args.Length>0&&args[0]=="--check";
      int port=args.Length>0&&!check?int.Parse(args[0]):8800;
      var json=new JavaScriptSerializer();
      using(var engine=new SpeechRecognitionEngine(new System.Globalization.CultureInfo("en-US")))
      using(var http=new WebClient()){
        var builder=new GrammarBuilder();builder.Culture=engine.RecognizerInfo.Culture;
        builder.Append(new Choices("hey luthur","luthur","hey luther","luther","hey luthor","luthor"));
        var wake=new Grammar(builder);wake.Name="wake";
        var requestBuilder=new GrammarBuilder();requestBuilder.Culture=engine.RecognizerInfo.Culture;requestBuilder.Append(new Choices("hey luthur","luthur","hey luther","luther","hey luthor","luthor"));requestBuilder.AppendDictation();
        var wakeRequest=new Grammar(requestBuilder);wakeRequest.Name="wake-request";
        engine.LoadGrammar(wake);
        engine.LoadGrammar(wakeRequest);
        if(check){Console.WriteLine("Wake grammar loaded. Microphone was not opened.");return 0;}
        engine.SetInputToDefaultAudioDevice();
        string url="http://127.0.0.1:"+port;
        http.Headers["Cookie"]=Environment.GetEnvironmentVariable("HQ_PC_VOICE_COOKIE")??"";
        for(;;){
          var call=engine.Recognize(TimeSpan.FromSeconds(10));
          if(call==null||call.Confidence<(call.Grammar.Name=="wake"?.7:.55))continue;
          try {
            http.Headers["X-HQ"]="1";http.Headers["Content-Type"]="application/json";
            var text=Regex.Replace(call.Text,@"^(?:hey\s+)?(?:luthur|luther|luthor)\b[\s,.!?]*","",RegexOptions.IgnoreCase).Trim();
            http.UploadString(url+"/api/pc-voice/event",json.Serialize(new {kind="wake",text=text}));
            // The dashboard takes over recognition and speech in the chosen voice.
            return 0;
          }catch{Console.Error.WriteLine("Could not hand wake request to LUTHUR. Unlock and open the app.");Thread.Sleep(3000);}
        }
      }
    }catch{Console.Error.WriteLine("Windows wake listener unavailable. Check the microphone and speech recognizer.");return 1;}
  }
}
