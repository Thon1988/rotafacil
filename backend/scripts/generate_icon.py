"""One-time icon generator for Rota+Rápida App.
Generates a 1024x1024 PNG icon using Gemini Nano Banana.
"""
import asyncio
import os
import base64
from pathlib import Path
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent.parent / ".env")

PROMPT = (
    "Mobile app icon design, exactly 1024x1024 pixels, perfectly square with iOS-style rounded corners (squircle). "
    "MAIN ELEMENT — center of icon: a single huge bold PLUS SIGN (mathematical '+') made of EXACTLY TWO white crossed bars: "
    "one perfectly HORIZONTAL bar and one perfectly VERTICAL bar, crossing each other at 90 degrees in the dead center. "
    "Each bar has thick rounded ends (capsule shape). The plus sign should fill about 60% of the icon area. "
    "DO NOT make 4 separate petals or a star/asterisk — just TWO bars forming a clean clear '+' symbol like in math. "
    "Color of '+': pure white #FFFFFF. "
    "Background: smooth vibrant orange gradient — top-left #ea580c (deeper orange), bottom-right #f97316 (lighter orange). "
    "Absolutely NO purple, NO violet, NO pink, NO blue. Only orange and white. "
    "Subtle small white road/path line forming a curve in the bottom-right corner of the icon, very small, like a tiny route trail (under 10% of icon area). "
    "Flat 2D vector design, premium quality, Google Play Store / App Store ready. "
    "NO text, NO letters, NO numbers, NO words, NO logos."
)


async def main():
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not set")

    chat = LlmChat(
        api_key=api_key,
        session_id="icon-gen-rota-rapida-app",
        system_message="You are an expert mobile app icon designer.",
    )
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])

    msg = UserMessage(text=PROMPT)
    text, images = await chat.send_message_multimodal_response(msg)
    print("LLM text response (truncated):", (text or "")[:200])

    if not images:
        raise RuntimeError("No image returned by Gemini")

    out_dir = Path("/app/frontend/assets/images")
    out_dir.mkdir(parents=True, exist_ok=True)

    img = images[0]
    image_bytes = base64.b64decode(img["data"])
    targets = ["icon.png", "adaptive-icon.png", "favicon.png", "splash-icon.png"]
    for name in targets:
        path = out_dir / name
        path.write_bytes(image_bytes)
        print(f"Saved: {path} ({len(image_bytes)} bytes)")


if __name__ == "__main__":
    asyncio.run(main())
