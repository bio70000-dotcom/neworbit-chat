"""
NewOrbit 블로그 브랜딩 이미지 생성
- 로고 (512x512): 행성 고리 아이콘
- 커버 (1920x1080): 블로그 헤더 이미지
"""
import os
import time
import shutil

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "branding")
os.makedirs(OUTPUT_DIR, exist_ok=True)

NEGATIVE = (
    "ugly, blurry, lowres, text, watermark, logo text, letters, words, "
    "low quality, jpeg artifacts, noisy, grainy"
)

IMAGES = [
    {
        "id": "logo",
        "name": "로고 (512x512)",
        "prompt": (
            "a stunning minimalist logo icon, glowing orbital ring around a small planet, "
            "deep space background, dark navy blue and electric blue gradient, "
            "clean vector-like design, single thin luminous ring orbiting a sphere, "
            "futuristic and elegant, sharp crisp edges, "
            "centered composition, icon style, no text, "
            "8k ultra detailed, cinema 4d render quality"
        ),
        "width": 512,
        "height": 512,
    },
    {
        "id": "cover",
        "name": "커버 (1280x512)",
        "prompt": (
            "a breathtaking wide panoramic space scene, "
            "a luminous orbital ring glowing with electric blue and purple neon light, "
            "orbiting around a dark elegant planet, "
            "deep space background with subtle stars and nebula, "
            "dark navy to black gradient background, "
            "cinematic wide angle, ultra sharp, "
            "futuristic minimal aesthetic, clean and modern, "
            "no text, no watermark, blog header style, "
            "8k ultra detailed, photorealistic render"
        ),
        "width": 1280,
        "height": 512,
    },
    {
        "id": "favicon",
        "name": "파비콘 (512x512)",
        "prompt": (
            "a simple minimalist icon of a glowing orbital ring, "
            "single bright blue-white ring on solid dark navy background, "
            "extremely clean and simple, geometric, "
            "perfect circle ring shape, thin elegant line, "
            "centered, icon design, no text, flat design, "
            "8k ultra sharp, vector quality"
        ),
        "width": 512,
        "height": 512,
    },
]


def generate(client, img_config):
    from gradio_client import Client
    
    print(f"\n[{img_config['name']}] 생성 중...")
    
    result = client.predict(
        "",                          # id_task
        img_config["prompt"],        # Prompt
        NEGATIVE,                    # Negative prompt
        [],                          # Styles
        1,                           # Batch count
        2,                           # Batch size
        7.0,                         # CFG Scale
        3.5,                         # Distilled CFG Scale
        img_config["height"],        # Height
        img_config["width"],         # Width
        False,                       # Hires fix
        0.7, 2.0, "Latent", 0, 0, 0,
        "Use same checkpoint", ["Use same choices"],
        "Use same sampler", "Use same scheduler",
        "", "", 7.0, 3.5,
        None, None,
        30,                          # Steps
        "DPM++ 2M",                  # Sampler
        "Karras",                    # Scheduler
        False, "", 0.8,
        -1.0,                        # Seed
        False, -1.0, 0.0, 0, 0,
        # Advanced defaults
        False, 7.0, 1.0, "Constant", 0.0, "Constant", 0.0, 1.0,
        "enable", "MEAN", "AD", 1.0,
        False, 1.01, 1.02, 0.99, 0.95, 0.0, 1.0,
        False, 0.5, 2.0, 1.0,
        False, 3.0, 0.0, 0.0, 1.0,
        False, 3, 2.0, 0.0, 0.35, True, "bicubic", "bicubic",
        False, 0.0, "anisotropic", 0.0, "reinhard", 100.0, 0.0,
        "subtract", 0.0, 0.0,
        "gaussian", "add", 0.0, 100, 127, 0.0,
        "hard_clamp", 5.0, 0.0, "None", "None",
        False, "MultiDiffusion", 768, 768, 64, 4, False, 1.0, False, False,
        False, False, "positive", "comma", 0, False, False, "start", "",
        False, "Seed", "", "", "Nothing", "", "", "Nothing", "", "",
        True, False, False, False, False, False, False, 0, False,
        api_name="/txt2img",
    )
    
    saved = []
    gallery = result[0] if isinstance(result, tuple) else result
    if isinstance(gallery, list):
        for i, item in enumerate(gallery):
            src = item.get("image", item) if isinstance(item, dict) else item
            if src and os.path.exists(src):
                dst = os.path.join(OUTPUT_DIR, f"{img_config['id']}_{i+1}.png")
                shutil.copy2(src, dst)
                saved.append(dst)
                print(f"  저장: {dst}")
    return saved


if __name__ == "__main__":
    from gradio_client import Client
    
    print("=" * 50)
    print("  NewOrbit 브랜딩 이미지 생성")
    print("=" * 50)
    
    client = Client("http://127.0.0.1:7860")
    
    for img in IMAGES:
        try:
            generate(client, img)
        except Exception as e:
            print(f"  실패: {e}")
        time.sleep(2)
    
    print(f"\n완료! 저장 위치: {OUTPUT_DIR}")
