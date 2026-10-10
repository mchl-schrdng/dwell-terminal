import AppKit
import Foundation

let destination = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
func color(_ hex: Int) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
}
let tile = NSBezierPath(roundedRect: NSRect(x: 82, y: 82, width: 860, height: 860), xRadius: 188, yRadius: 188)
NSGradient(starting: color(0x343A44), ending: color(0x181A1F))!.draw(in: tile, angle: -55)
color(0xECEDEF).setStroke()
let mark = NSBezierPath()
mark.lineWidth = 42
mark.lineCapStyle = .round
mark.lineJoinStyle = .round
// Match the 64-point vector mark, centered inside the macOS icon tile.
func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: 122 + x * 12, y: 896 - y * 12) }
mark.move(to: point(17, 14))
mark.line(to: point(17, 50))
mark.move(to: point(27, 14))
mark.line(to: point(30, 14))
mark.curve(to: point(48, 32), controlPoint1: point(41, 14), controlPoint2: point(48, 21))
mark.curve(to: point(30, 50), controlPoint1: point(48, 43), controlPoint2: point(41, 50))
mark.line(to: point(27, 50))
mark.stroke()
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: destination))
