// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Braban",
    platforms: [.iOS(.v17)],
    products: [.library(name: "Braban", targets: ["Braban"])],
    targets: [
        .target(name: "Braban", path: "Braban",
                resources: [.process("Assets.xcassets"), .copy("Game")],
                linkerSettings: [.unsafeFlags(["-Xlinker", "-platform_version", "-Xlinker", "ios",
                                                "-Xlinker", "17.0", "-Xlinker", "27.0"])])
    ],
    swiftLanguageVersions: [.v5]
)
