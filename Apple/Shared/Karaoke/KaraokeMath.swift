import AVFoundation
import Foundation

// The sums behind Karaoke mode, kept apart from the audio engine so they are tested: how loud the
// vocals are, the key as a pitch shift, which channels of the server's 5.1 file are which, and the
// copy of those channels into the two stereo pairs the engine plays. docs/KARAOKE.md; the same on
// the web (`vocalGains`, pitch.ts) and Android (VocalMix.kt, AudioMath.kt).

enum KaraokeMath {
    /// Karaoke's key range in semitones, either way.
    static let keyRange = 6

    /// How much of the voice is left, 0 (the instrumental) to 1 (the song as recorded).
    static func clampLevel(_ level: Double) -> Double {
        level.isFinite ? min(1, max(0, level)) : 0
    }

    /// The key in whole semitones within ±6.
    static func clampKey(_ key: Int) -> Int {
        min(keyRange, max(-keyRange, key))
    }

    /// The key in effect: only while Karaoke plays (the value is kept while it does not).
    static func effectiveKey(karaoke: Bool, key: Int) -> Int {
        karaoke ? clampKey(key) : 0
    }

    /// The two nodes' volumes: the instrumental as it is, the vocals at the level, so the mix is
    /// `instrumental + level × vocals` as on the web and Android.
    static func volumes(level: Double) -> (instrumental: Float, vocals: Float) {
        (1, Float(clampLevel(level)))
    }

    /// A shift of whole semitones in cents, as the time-pitch unit takes it (100 cents a semitone, so
    /// the range is ±600, inside the unit's ±2400).
    static func cents(key: Int) -> Float {
        Float(clampKey(key) * 100)
    }

    /// A shift as a frequency ratio (equal temperament).
    static func ratio(key: Int) -> Double {
        pow(2, Double(clampKey(key)) / 12)
    }

    /// The text for a key: "Original key", "Up 2 semitones".
    static func keyText(_ key: Int) -> String {
        switch key {
        case 0: "Original key"
        default: "\(key > 0 ? "Up" : "Down") \(abs(key)) \(abs(key) == 1 ? "semitone" : "semitones")"
        }
    }

    /// A key as the sliders show it: "+2", "−3", "0".
    static func keyValue(_ key: Int) -> String {
        key > 0 ? "+\(key)" : key < 0 ? "\u{2212}\(-key)" : "0"
    }

    /// A level as a percentage.
    static func percent(_ level: Double) -> String {
        "\(Int((clampLevel(level) * 100).rounded()))%"
    }
}

/// Which channels of a 5.1 file hold the instrumental (front left and right) and the vocals (rear
/// left and right). The file's layout says where each is: AAC's own order is C L R Ls Rs LFE (tag
/// MPEG 5.1 D), the one Core Audio decodes it in; the others are the layouts a 5.1 file may carry.
/// With no layout, the order the server documents: FL FR FC LFE BL BR.
struct KaraokeChannels: Equatable, Sendable {
    var instrumental: [Int]
    var vocals: [Int]

    static let frontRear = KaraokeChannels(instrumental: [0, 1], vocals: [4, 5])

    static func forLayout(tag: AudioChannelLayoutTag?) -> KaraokeChannels {
        guard let tag else { return .frontRear }
        switch tag {
        case kAudioChannelLayoutTag_MPEG_5_1_D: // C L R Ls Rs LFE
            return KaraokeChannels(instrumental: [1, 2], vocals: [3, 4])
        case kAudioChannelLayoutTag_MPEG_5_1_C: // L C R Ls Rs LFE
            return KaraokeChannels(instrumental: [0, 2], vocals: [3, 4])
        case kAudioChannelLayoutTag_MPEG_5_1_B: // L R Ls Rs C LFE
            return KaraokeChannels(instrumental: [0, 1], vocals: [2, 3])
        default: // MPEG 5.1 A (L R C LFE Ls Rs), AudioUnit 5.1, and anything unknown
            return .frontRear
        }
    }

    /// The channels of a file of `count` channels with this layout: a 5.1 file is split as its layout
    /// says; a stereo or mono file (any other song, or one that was mixed down) plays whole, with no
    /// vocals of its own to turn down.
    static func forFile(channels count: Int, layout tag: AudioChannelLayoutTag?) -> KaraokeChannels {
        switch count {
        case 6...: forLayout(tag: tag)
        case 2...: KaraokeChannels(instrumental: [0, 1], vocals: [])
        default: KaraokeChannels(instrumental: [0, 0], vocals: [])
        }
    }

    /// Copies the two pairs of `source` into two stereo buffers of the same length (the vocals' is
    /// silent when the file has none). Returns false when the source does not have the channels.
    @discardableResult
    func split(_ source: AVAudioPCMBuffer, into instrumental: AVAudioPCMBuffer, vocals: AVAudioPCMBuffer) -> Bool {
        guard let from = source.floatChannelData, let inst = instrumental.floatChannelData, let voc = vocals.floatChannelData,
              Int(source.format.channelCount) > (self.instrumental + self.vocals).max() ?? 0,
              instrumental.format.channelCount == 2, vocals.format.channelCount == 2,
              instrumental.frameCapacity >= source.frameLength, vocals.frameCapacity >= source.frameLength
        else { return false }
        let n = Int(source.frameLength)
        for pair in 0..<2 {
            inst[pair].update(from: from[self.instrumental[pair]], count: n)
            if pair < self.vocals.count {
                voc[pair].update(from: from[self.vocals[pair]], count: n)
            } else {
                voc[pair].update(repeating: 0, count: n)
            }
        }
        instrumental.frameLength = source.frameLength
        vocals.frameLength = source.frameLength
        return true
    }
}
