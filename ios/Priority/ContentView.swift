import SwiftUI

// Placeholder home screen until the Today list lands in Sprint 3.
// Colors match the website's theme tokens in src/app/globals.css.
struct ContentView: View {
    private let background = Color(red: 8 / 255, green: 9 / 255, blue: 10 / 255)
    private let secondary = Color(red: 155 / 255, green: 161 / 255, blue: 163 / 255)

    private var version: String {
        let info = Bundle.main.infoDictionary
        let marketing = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "Version \(marketing) (\(build))"
    }

    var body: some View {
        ZStack {
            background.ignoresSafeArea()

            VStack(spacing: 20) {
                HStack(spacing: 10) {
                    Text("P.")
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 36, height: 36)
                        .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.accentColor, lineWidth: 1))
                    Text("PRIORITY")
                        .font(.system(size: 14, weight: .semibold))
                        .tracking(2.2)
                        .foregroundStyle(.white)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Priority")

                Text("Your classes, in the order that matters today.")
                    .font(.body)
                    .foregroundStyle(secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)

            VStack {
                Spacer()
                Text(version)
                    .font(.footnote)
                    .foregroundStyle(secondary.opacity(0.7))
                    .padding(.bottom, 12)
            }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}
