import AVFoundation
import UIKit
import WebKit

/// Native audio for the game: the page sends commands ("play bgm09 looped", "fade se 2", ...) and
/// AVAudioEngine does the playback, so audio survives screen lock, calls and route changes like a normal app.
final class AudioBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let root: URL
    weak var web: WKWebView?
    private let engine = AVAudioEngine()
    private var kindMixers: [String: AVAudioMixerNode] = [:]
    private var tracks: [String: Track] = [:]
    private var fadeTimer: Timer?
    /// keep sound while the app is merely inactive (notification center etc.)
    private var keepWhenInactive = true
    private var isInactive = false
    private var lastBottomEdgeGesture: CFTimeInterval = 0
    private var recentBottomEdgeGesture: Bool { CACurrentMediaTime() - lastBottomEdgeGesture < 1.5 }

    /// Called when a touch from the bottom edge was taken over by the system (home indicator → app switcher / home).
    /// The cancellation can arrive just before or just after the app turns inactive, so handle both orders.
    func noteBottomEdgeGesture() {
        lastBottomEdgeGesture = CACurrentMediaTime()
        if isInactive {
            tracks.values.forEach { $0.rememberPosition() }
            engine.pause()
            pauseGame(true)
        }
    }

    /// Pause / resume the whole game in the page (clock, script, typing, movie).
    private func pauseGame(_ on: Bool) {
        let arg = on ? "true" : "false"
        web?.evaluateJavaScript("window.__gamePause && window.__gamePause(\(arg))")
    }
    private var tokens: [NSObjectProtocol] = []

    init(root: URL) {
        self.root = root
        super.init()
        for kind in ["bgm", "se", "voice"] {
            let m = AVAudioMixerNode()
            engine.attach(m)
            engine.connect(m, to: engine.mainMixerNode, format: nil)
            kindMixers[kind] = m
        }
        configureSession()
        startEngine()
        observe()
    }

    // MARK: - session / engine lifecycle

    private func configureSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, options: [])
        try? s.setActive(true)
    }

    private func startEngine() {
        if !engine.isRunning {
            engine.prepare()
            try? engine.start()
        }
    }

    /// Restart the engine and continue looping tracks from where they were.
    func recover() {
        let resumeList = tracks.values.compactMap { t -> (Track, Track.State)? in
            guard let st = t.snapshot() else { return nil }
            return (t, st)
        }
        configureSession()
        startEngine()
        // players that kept their state just continue; tracks the system stopped are restarted
        tracks.values.forEach { if !$0.needsRestart && ($0.player?.isPlaying ?? false) { $0.savedPosition = nil } }
        for (t, st) in resumeList where t.player == nil || !(t.player?.isPlaying ?? false) || t.needsRestart {
            t.needsRestart = false
            play(track: t, path: st.path, loop: true, loopStart: st.loopStart, loopEnd: st.loopEnd,
                 offset: st.position, volume: st.volume, fadeIn: 0.3, token: t.token)
        }
    }

    private func observe() {
        let nc = NotificationCenter.default
        tokens.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self, let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began { self.markForRestart() } else { self.recover() }
        })
        tokens.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            self?.markForRestart()
            self?.recover()
        })
        tokens.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.markForRestart()
            self?.recover()
        })
        tokens.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.recover()
        })
        // "Inactive" = notification/control center pulled down, call banner, app switcher animation.
        // Keep playing there if the user chose so; leaving the app (background / screen lock) always pauses.
        tokens.append(nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.isInactive = true
            self.tracks.values.forEach { $0.rememberPosition() }
            // the app switcher (home-indicator swipe) always pauses; Notification/Control Center follows the setting
            if !self.keepWhenInactive || self.recentBottomEdgeGesture { self.engine.pause() }
            // app switcher: also stop the game itself (Notification Center does not)
            if self.recentBottomEdgeGesture { self.pauseGame(true) }
        })
        tokens.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.isInactive = false
            self?.pauseGame(false)
        })
        tokens.append(nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.tracks.values.forEach { $0.rememberPosition() }
            self.engine.pause()
            self.pauseGame(true)
        })
        tokens.append(nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.recover()
        })
    }

    private func markForRestart() {
        tracks.values.forEach { $0.rememberPosition(); $0.needsRestart = true }
    }

    // MARK: - JS bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "bad message"); return
        }
        let name = body["track"] as? String ?? ""
        let num = { (k: String) -> Double? in (body[k] as? NSNumber)?.doubleValue }
        switch cmd {
        case "play":
            let t = track(name)
            let dur = play(track: t, path: body["path"] as? String ?? "", loop: body["loop"] as? Bool ?? false,
                           loopStart: num("loopStart"), loopEnd: num("loopEnd"), offset: num("offset") ?? 0,
                           volume: Float(num("volume") ?? 1), fadeIn: (num("fadein") ?? 0) / 1000,
                           token: Int(num("token") ?? 0))
            replyHandler(dur * 1000, nil)
        case "stop":
            stop(track(name), fade: (num("fade") ?? 0) / 1000)
            replyHandler(nil, nil)
        case "fade":
            fade(track(name), to: Float(num("volume") ?? 1), seconds: (num("time") ?? 0) / 1000, stopAtEnd: false)
            replyHandler(nil, nil)
        case "pause":
            let t = track(name)
            t.paused = t.snapshot()
            stop(t, fade: (num("fade") ?? 0) / 1000, keepPaused: true)
            replyHandler(nil, nil)
        case "resume":
            let t = track(name)
            if let st = t.paused {
                t.paused = nil
                _ = play(track: t, path: st.path, loop: true, loopStart: st.loopStart, loopEnd: st.loopEnd,
                         offset: st.position, volume: st.volume, fadeIn: (num("fade") ?? 0) / 1000, token: Int(num("token") ?? Double(t.token)))
            }
            replyHandler(nil, nil)
        case "cfg":
            for kind in ["bgm", "se", "voice"] { if let v = num(kind) { kindMixers[kind]?.outputVolume = Float(v) } }
            replyHandler(nil, nil)
        case "policy":
            keepWhenInactive = body["keepWhenInactive"] as? Bool ?? true
            replyHandler(nil, nil)
        case "recover":
            recover()
            replyHandler(nil, nil)
        default:
            replyHandler(nil, "unknown command")
        }
    }

    private func track(_ name: String) -> Track {
        if let t = tracks[name] { return t }
        let kind = name == "bgm" ? "bgm" : name == "voice" ? "voice" : "se"
        let t = Track(name: name, kind: kind)
        tracks[name] = t
        return t
    }

    private func notifyEnded(_ t: Track, token: Int) {
        web?.evaluateJavaScript("window.Sound && Sound._ended && Sound._ended(\(jsString(t.name)), \(token))")
    }

    private func jsString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }

    // MARK: - playback

    @discardableResult
    private func play(track t: Track, path: String, loop: Bool, loopStart: Double?, loopEnd: Double?,
                      offset: Double, volume: Float, fadeIn: Double, token: Int) -> Double {
        stop(t, fade: 0)
        t.token = token
        let url = root.appendingPathComponent(path)
        guard let file = try? AVAudioFile(forReading: url) else { return 0 }
        startEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: kindMixers[t.kind]!, format: file.processingFormat)
        let rate = file.processingFormat.sampleRate
        let length = file.length
        var ls: AVAudioFramePosition = 0, le: AVAudioFramePosition = length
        if loop, let a = loopStart, let b = loopEnd, b > a {
            ls = AVAudioFramePosition(a * rate / 44100)
            le = min(AVAudioFramePosition(b * rate / 44100), length)
        }
        var start = AVAudioFramePosition(offset * rate)
        if start >= (loop ? le : length) || start < 0 { start = 0 }
        t.player = player
        t.file = file
        t.path = path
        t.loop = loop
        t.loopStartFrame = ls
        t.loopEndFrame = le
        t.startFrame = start
        t.loopStartSec = loopStart
        t.loopEndSec = loopEnd
        t.volume = volume
        t.savedPosition = nil

        let tok = token
        if loop {
            player.scheduleSegment(file, startingFrame: start, frameCount: AVAudioFrameCount(le - start), at: nil, completionHandler: nil)
            // keep two loop segments queued; every consumed segment queues another (gapless)
            func queueLoop() {
                player.scheduleSegment(file, startingFrame: ls, frameCount: AVAudioFrameCount(le - ls), at: nil,
                                       completionCallbackType: .dataConsumed) { [weak self, weak player] _ in
                    DispatchQueue.main.async {
                        guard let self, let player, t.player === player, t.token == tok else { return }
                        queueLoop()
                        _ = self
                    }
                }
            }
            queueLoop()
            queueLoop()
        } else {
            player.scheduleSegment(file, startingFrame: start, frameCount: AVAudioFrameCount(length - start), at: nil,
                                   completionCallbackType: .dataPlayedBack) { [weak self, weak player] _ in
                DispatchQueue.main.async {
                    guard let self, let player, t.player === player, t.token == tok else { return }
                    self.detach(t)
                    self.notifyEnded(t, token: tok)
                }
            }
        }
        if fadeIn > 0 {
            player.volume = 0
            player.play()
            fade(t, to: volume, seconds: fadeIn, stopAtEnd: false)
        } else {
            player.volume = volume
            player.play()
        }
        return Double(length) / rate
    }

    private func detach(_ t: Track) {
        if let p = t.player {
            p.stop()
            engine.detach(p)
        }
        t.player = nil
        t.fade = nil
        t.savedPosition = nil
        t.needsRestart = false
    }

    private func stop(_ t: Track, fade seconds: Double, keepPaused: Bool = false) {
        if !keepPaused { t.paused = nil }
        guard t.player != nil else { return }
        if seconds > 0 {
            fade(t, to: 0, seconds: seconds, stopAtEnd: true)
        } else {
            detach(t)
        }
    }

    private func fade(_ t: Track, to target: Float, seconds: Double, stopAtEnd: Bool) {
        guard let p = t.player else { return }
        if !stopAtEnd { t.volume = target }
        if seconds <= 0 {
            p.volume = target
            if stopAtEnd { detach(t) }
            return
        }
        t.fade = Track.Fade(from: p.volume, to: target, start: CACurrentMediaTime(), duration: seconds, stopAtEnd: stopAtEnd, player: p)
        if fadeTimer == nil {
            fadeTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.tickFades() }
        }
    }

    private func tickFades() {
        let now = CACurrentMediaTime()
        var active = false
        for t in tracks.values {
            guard let f = t.fade else { continue }
            guard t.player === f.player else { t.fade = nil; continue }
            let k = min(1, (now - f.start) / f.duration)
            f.player.volume = f.from + (f.to - f.from) * Float(k)
            if k >= 1 {
                t.fade = nil
                if f.stopAtEnd { detach(t) }
            } else { active = true }
        }
        if !active { fadeTimer?.invalidate(); fadeTimer = nil }
    }

    // MARK: - track state

    final class Track {
        struct Fade { let from: Float; let to: Float; let start: CFTimeInterval; let duration: Double; let stopAtEnd: Bool; let player: AVAudioPlayerNode }
        struct State { let path: String; let position: Double; let volume: Float; let loopStart: Double?; let loopEnd: Double? }
        let name: String
        let kind: String
        var player: AVAudioPlayerNode?
        var file: AVAudioFile?
        var path = ""
        var loop = false
        var loopStartFrame: AVAudioFramePosition = 0
        var loopEndFrame: AVAudioFramePosition = 0
        var startFrame: AVAudioFramePosition = 0
        var loopStartSec: Double?
        var loopEndSec: Double?
        var volume: Float = 1
        var token = 0
        var fade: Fade?
        var paused: State?
        var savedPosition: Double?
        var needsRestart = false

        init(name: String, kind: String) { self.name = name; self.kind = kind }

        /// current position in seconds (loop-aware)
        func position() -> Double {
            if let s = savedPosition { return s }
            guard let p = player, let file, let nodeTime = p.lastRenderTime, let pt = p.playerTime(forNodeTime: nodeTime) else { return 0 }
            let rate = file.processingFormat.sampleRate
            var frame = startFrame + pt.sampleTime
            if loop && frame >= loopEndFrame && loopEndFrame > loopStartFrame {
                frame = loopStartFrame + (frame - loopEndFrame) % (loopEndFrame - loopStartFrame)
            }
            return Double(max(0, frame)) / rate
        }

        func rememberPosition() {
            if player != nil && loop { savedPosition = position() }
        }

        /// state for restarting a looping track
        func snapshot() -> State? {
            guard loop, player != nil || savedPosition != nil, !path.isEmpty else { return nil }
            return State(path: path, position: position(), volume: volume, loopStart: loopStartSec, loopEnd: loopEndSec)
        }
    }
}
