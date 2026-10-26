// OCR страниц через Apple Vision (macOS, бесплатно, офлайн).
// Запуск: swift scripts/ocr_vision.swift pages/*.png > out.jsonl
// На каждую картинку печатает одну строку JSON: {"file": "...", "text": "..."}
import Foundation
import Vision
import AppKit

func recognize(_ path: String) -> String {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["ru-RU", "en-US"]
    req.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { return "" }
    let obs = (req.results ?? []).sorted { a, b in
        // сверху вниз, затем слева направо (у Vision ось Y снизу)
        let ya = a.boundingBox.midY, yb = b.boundingBox.midY
        if abs(ya - yb) > 0.012 { return ya > yb }
        return a.boundingBox.minX < b.boundingBox.minX
    }
    return obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

for path in CommandLine.arguments.dropFirst() {
    let text = recognize(path)
    let obj: [String: String] = ["file": (path as NSString).lastPathComponent, "text": text]
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}
