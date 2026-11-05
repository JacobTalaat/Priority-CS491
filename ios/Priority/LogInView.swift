import SwiftUI

// Sign-in screen, shown whenever there is no session in the Keychain. Same
// dark palette and type feel as the website's login page.
struct LogInView: View {
    @ObservedObject var model: AuthModel

    private let background = Color(red: 8 / 255, green: 9 / 255, blue: 10 / 255)
    private let secondary = Color(red: 155 / 255, green: 161 / 255, blue: 163 / 255)
    private let field = Color(red: 22 / 255, green: 24 / 255, blue: 27 / 255)

    var body: some View {
        ZStack {
            background.ignoresSafeArea()

            VStack(spacing: 24) {
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

                VStack(alignment: .leading, spacing: 10) {
                    TextField("Email", text: $model.email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(field, in: RoundedRectangle(cornerRadius: 8))

                    SecureField("Password", text: $model.password)
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(field, in: RoundedRectangle(cornerRadius: 8))

                    Button {
                        Task { await model.signIn() }
                    } label: {
                        HStack {
                            if model.isSigningIn {
                                ProgressView().tint(.white)
                            } else {
                                Text("Log in").font(.body.weight(.semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(12)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(.black)
                    }
                    .disabled(model.isSigningIn || model.configProblem != nil)
                    .accessibilityLabel("Log in")

                    if let problem = model.configProblem {
                        Text(problem)
                            .font(.footnote)
                            .foregroundStyle(secondary)
                    } else if let error = model.errorText {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel(error)
                    }
                }
                .padding(.horizontal, 4)
            }
            .padding(.horizontal, 32)
        }
        .preferredColorScheme(.dark)
    }
}
