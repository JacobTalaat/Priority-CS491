// Renders the Priority mark (the website header's "P." box) as iOS app icon and launch images.
//
// Run from the repo root, with any Archivo font file (the website's font; next dev caches it
// as .woff2 under .next/dev/static/media, and CoreText reads WOFF2 directly):
//   swift ios/design/render-icon.swift path/to/Archivo.woff2 /tmp/icon-out
// then copy the PNGs into ios/Priority/Assets.xcassets (AppIcon.png is also AppIcon-Dark.png).
// Proportions follow src/components/app-shell/app-shell.module.css .mark: a 29px box with a
// 1px accent border, 3px corners, and "P." at 15px, weight 800, letter-spacing -0.08em.
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let fontPath = CommandLine.arguments[1]
let outDir = CommandLine.arguments[2]

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}
let background = color(0x08090a)   // --background (dark)
let accent = color(0x7fb2a4)       // --accent (dark)
let white = color(0xffffff)
let black = color(0x000000)

let fontData = try! Data(contentsOf: URL(fileURLWithPath: fontPath)) as CFData
let baseDescriptor = (CTFontManagerCreateFontDescriptorsFromData(fontData) as! [CTFontDescriptor])[0]
// Archivo is a variable font; 'wght' is the four-character tag 0x77676874.
let weighted = CTFontDescriptorCreateCopyWithAttributes(baseDescriptor, [
    kCTFontVariationAttribute: [0x77676874: 800],
] as CFDictionary)

func drawMark(in context: CGContext, center: CGPoint, box: CGFloat, ink: CGColor) {
    let scale = box / 29
    let border = 1 * scale
    let radius = 3 * scale
    let rect = CGRect(x: center.x - box / 2, y: center.y - box / 2, width: box, height: box)
        .insetBy(dx: border / 2, dy: border / 2)
    context.setStrokeColor(ink)
    context.setLineWidth(border)
    context.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.strokePath()

    let fontSize = 15 * scale
    let font = CTFontCreateWithFontDescriptor(weighted, fontSize, nil)
    let text = NSAttributedString(string: "P.", attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): ink,
        NSAttributedString.Key(kCTKernAttributeName as String): -0.08 * fontSize,
    ])
    let line = CTLineCreateWithAttributedString(text)
    // Centre on the glyphs' ink, not the line box, so the mark sits optically in the middle.
    let ink = CTLineGetImageBounds(line, context)
    context.textPosition = CGPoint(x: center.x - ink.midX, y: center.y - ink.midY)
    CTLineDraw(line, context)
}

func render(size: Int, fill: CGColor?, ink: CGColor, boxFraction: CGFloat, name: String) {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                            space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    if let fill {
        context.setFillColor(fill)
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    }
    let side = CGFloat(size)
    drawMark(in: context, center: CGPoint(x: side / 2, y: side / 2), box: side * boxFraction, ink: ink)
    var image = context.makeImage()!
    if fill != nil {
        // App icons must be opaque: drop the alpha channel entirely.
        let opaque = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                               space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        opaque.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
        image = opaque.makeImage()!
    }
    let url = URL(fileURLWithPath: outDir).appendingPathComponent(name)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
    print("wrote", name)
}

// App icon: the mark at about 60% of the canvas, full bleed dark background (iOS rounds the corners).
render(size: 1024, fill: background, ink: accent, boxFraction: 0.6, name: "AppIcon.png")
// Tinted appearance: iOS tints a grayscale icon, so the mark is white on black.
render(size: 1024, fill: black, ink: white, boxFraction: 0.6, name: "AppIcon-Tinted.png")
// Launch screen: just the mark on a transparent canvas, shown centred on the launch background.
// 96 pt square (box) inside a 120 pt image, at 2x and 3x.
render(size: 240, fill: nil, ink: accent, boxFraction: 0.8, name: "LaunchMark@2x.png")
render(size: 360, fill: nil, ink: accent, boxFraction: 0.8, name: "LaunchMark@3x.png")
