# Mushroom face filter

Quaternius CC0 Mushroom GLB를 원본 3D 모델 그대로 웹캠 위에 합성하는 무문자 풀스크린 얼굴 필터입니다. Face Landmarker가 얼굴 위치와 고개 움직임, 눈 깜빡임·웃음·삐죽임·입 벌림을 추적합니다. 입 벌림은 모델에 포함된 Mouth 본의 원래 이동으로 표현합니다. AI로 만든 감은 눈 상태는 원본 모델의 UV 텍스처와 셰이더에서 부드럽게 섞어 표시하며, 눈 깜빡임에는 본 스케일 변형을 사용하지 않습니다.

## 로컬 실행

```sh
python3 -m http.server 4173
```

브라우저에서 `http://localhost:4173`을 열고 가운데 카메라 아이콘을 누르세요. HTTPS 또는 localhost에서 카메라를 사용할 수 있습니다. Three.js와 MediaPipe는 CDN에서 불러옵니다.

## 정적 배포

`index.html`, `styles.css`, `app.js`, `assets/mushroom.glb`를 HTTPS 정적 호스팅에 올리면 됩니다. 카메라 영상은 브라우저 안에서 처리됩니다.
