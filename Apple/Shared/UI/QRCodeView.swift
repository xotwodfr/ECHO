import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/// A QR code, drawn crisp at any size: dark modules on a white plate with a quiet zone, as every
/// scanner reads them, with error correction H so the Echo mark can sit in its middle (the web's
/// and Android's guest QR).
struct QRCodeView: View {
    let text: String
    var label = "Guest QR code"
    var mark = true

    var body: some View {
        ZStack {
            if let image = Self.image(text) {
                Image(decorative: image, scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .aspectRatio(1, contentMode: .fit)
            }
            if mark {
                EchoMark()
                    .padding(7)
                    .background(Color.harbourNavy, in: .circle)
                    .padding(4)
                    .background(.white, in: .circle)
                    .frame(width: 58, height: 58)
            }
        }
        .padding(18)
        .background(.white, in: .rect(cornerRadius: 26))
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isImage)
    }

    /// One pixel a module; the view scales it up without smoothing.
    static func image(_ text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "H"
        guard let output = filter.outputImage else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }
}
