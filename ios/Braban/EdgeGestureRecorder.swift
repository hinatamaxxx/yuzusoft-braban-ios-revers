import UIKit
import UIKit.UIGestureRecognizerSubclass

/// Passive recognizer that never takes touches from the web view. It remembers when a touch that
/// started at the bottom or top edge was cancelled by the system — i.e. the home-indicator swipe
/// (app switcher / home) or a pull-down of Notification / Control Center — so the audio code can tell
/// these apart when the app becomes inactive.
final class EdgeGestureRecorder: UIGestureRecognizer {
    enum Edge { case top, bottom }
    var onSystemEdgeGesture: ((Edge) -> Void)?
    private var startY: CGFloat?
    private let margin: CGFloat = 44

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        if let t = touches.first, let v = view { startY = t.location(in: v).y }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        startY = nil
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        if let y = startY, let v = view {
            if y > v.bounds.height - margin { onSystemEdgeGesture?(.bottom) }
            else if y < margin { onSystemEdgeGesture?(.top) }
        }
        startY = nil
        state = .failed
    }

    override func reset() { startY = nil }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
