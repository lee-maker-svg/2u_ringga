const video=document.querySelector('#webcam');
const canvas=document.querySelector('#overlay');
const startButton=document.querySelector('#startButton');

let THREE,renderer,scene,camera,followRoot,mushroom,mouthBone,mixer,landmarker,closedEyesTexture;
let modelSize,modelCenter,pose=null,lastVideoTime=-1,lastFrameTime=performance.now(),frameStarted=false;
let smooth={x:0,y:0,width:0,roll:0,yaw:0,pitch:0,jaw:0,blinkLeft:0,blinkRight:0,squint:0,smile:0,frown:0,pucker:0,browUp:0,browDown:0,sneer:0,smileAsym:0,frownAsym:0};
const blinkUniform={value:0};

const clamp=(v,min=-1,max=1)=>Math.max(min,Math.min(max,v));
const blend=(items,name)=>items?.find(item=>item.categoryName===name)?.score??0;
const mix=(a,b,t)=>a+(b-a)*t;

function resize(){
  if(!renderer||!canvas.clientWidth||!canvas.clientHeight)return;
  const width=canvas.clientWidth,height=canvas.clientHeight;
  renderer.setSize(width,height,false);
  camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

async function setupMushroom(){
  const [THREEImport,{GLTFLoader}]=await Promise.all([
    import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'),
    import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js'),
  ]);
  THREE=THREEImport;
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene();
  // The model is scaled in screen-pixel units, so its depth is also much
  // larger than the tiny default camera range. Keep the whole GLB in view.
  camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,5000);
  camera.position.set(0,0,2000);camera.lookAt(0,0,0);
  followRoot=new THREE.Group();followRoot.visible=false;scene.add(followRoot);
  resize();

  const gltf=await new GLTFLoader().loadAsync('./assets/mushroom.glb');
  mushroom=gltf.scene;
  closedEyesTexture=await new THREE.TextureLoader().loadAsync('./assets/mushroom-eyes-closed.png');
  closedEyesTexture.colorSpace=THREE.SRGBColorSpace;
  closedEyesTexture.flipY=false;
  closedEyesTexture.needsUpdate=true;
  mushroom.traverse(object=>{
    if(!object.isSkinnedMesh)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials){
      material.onBeforeCompile=shader=>{
        shader.uniforms.closedEyesMap={value:closedEyesTexture};
        shader.uniforms.blinkAmount=blinkUniform;
        shader.fragmentShader=shader.fragmentShader.replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D closedEyesMap;\nuniform float blinkAmount;'
        );
        shader.fragmentShader=shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\nvec4 closedEyeColor=texture2D(closedEyesMap,vMapUv);\ndiffuseColor.rgb=mix(diffuseColor.rgb,closedEyeColor.rgb,blinkAmount);'
        );
      };
      material.customProgramCacheKey=()=> 'mushroom-generated-blink-v1';
      material.needsUpdate=true;
    }
  });
  mushroom.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(mushroom);
  modelSize=bounds.getSize(new THREE.Vector3());
  modelCenter=bounds.getCenter(new THREE.Vector3());
  const pivot=new THREE.Group();pivot.position.copy(modelCenter).multiplyScalar(-1);pivot.add(mushroom);followRoot.add(pivot);
  mouthBone=mushroom.getObjectByName('Mouth');

  const idle=THREE.AnimationClip.findByName(gltf.animations,'Idle');
  if(idle){mixer=new THREE.AnimationMixer(mushroom);const action=mixer.clipAction(idle);action.setEffectiveWeight(.16);action.setEffectiveTimeScale(.72);action.play();}
  canvas.dataset.modelReady='true';
}

async function setupLandmarker(){
  const {FilesetResolver,FaceLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32');
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
  const options={runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,minFaceDetectionConfidence:.58,minFacePresenceConfidence:.58,minTrackingConfidence:.58};
  const modelAssetPath='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  try{return await FaceLandmarker.createFromOptions(vision,{...options,baseOptions:{modelAssetPath,delegate:'GPU'}});}
  catch{return await FaceLandmarker.createFromOptions(vision,{...options,baseOptions:{modelAssetPath,delegate:'CPU'}});}
}

function screenPoint(landmarks,index,width,height){
  const vw=video.videoWidth,vh=video.videoHeight;
  const scale=Math.max(width/vw,height/vh);
  return{x:(width-vw*scale)/2+landmarks[index].x*vw*scale,y:(height-vh*scale)/2+landmarks[index].y*vh*scale};
}

function trackFace(result){
  const landmarks=result.faceLandmarks?.[0];
  if(!landmarks||!followRoot){canvas.dataset.faceDetected='false';pose=null;followRoot.visible=false;return;}
  canvas.dataset.faceDetected='true';
  const width=canvas.clientWidth,height=canvas.clientHeight;
  const eyeLeft=screenPoint(landmarks,33,width,height),eyeRight=screenPoint(landmarks,263,width,height);
  const eyeCenter={x:(eyeLeft.x+eyeRight.x)/2,y:(eyeLeft.y+eyeRight.y)/2};
  const eyeDistance=Math.max(1,Math.hypot(eyeRight.x-eyeLeft.x,eyeRight.y-eyeLeft.y));
  const cheekLeft=screenPoint(landmarks,234,width,height),cheekRight=screenPoint(landmarks,454,width,height);
  const forehead=screenPoint(landmarks,10,width,height),chin=screenPoint(landmarks,152,width,height);
  const nose=screenPoint(landmarks,1,width,height);
  const mouthUpper=screenPoint(landmarks,13,width,height),mouthLower=screenPoint(landmarks,14,width,height);
  const mouthCenter={x:(mouthUpper.x+mouthLower.x)/2,y:(mouthUpper.y+mouthLower.y)/2};
  const yaw=clamp((nose.x-eyeCenter.x)/eyeDistance*1.75,-.72,.72);
  const pitch=clamp(((nose.y-eyeCenter.y)/eyeDistance-.48)*1.35,-.48,.48);
  const roll=-Math.atan2(eyeRight.y-eyeLeft.y,eyeRight.x-eyeLeft.x);
  const blendshapes=result.faceBlendshapes?.[0]?.categories;
  const mouthOpen=clamp(Math.max(blend(blendshapes,'jawOpen'),(Math.hypot(mouthLower.x-mouthUpper.x,mouthLower.y-mouthUpper.y)/eyeDistance-.025)*2.8),0,1);
  const smileLeft=blend(blendshapes,'mouthSmileLeft'),smileRight=blend(blendshapes,'mouthSmileRight');
  const frownLeft=blend(blendshapes,'mouthFrownLeft'),frownRight=blend(blendshapes,'mouthFrownRight');
  pose={
    x:mouthCenter.x,y:mouthCenter.y,width:Math.hypot(cheekRight.x-cheekLeft.x,cheekRight.y-cheekLeft.y),roll,yaw,pitch,jaw:mouthOpen,
    blinkLeft:blend(blendshapes,'eyeBlinkLeft'),blinkRight:blend(blendshapes,'eyeBlinkRight'),
    squint:(blend(blendshapes,'eyeSquintLeft')+blend(blendshapes,'eyeSquintRight'))/2,
    smile:(smileLeft+smileRight)/2,frown:(frownLeft+frownRight)/2,pucker:blend(blendshapes,'mouthPucker'),
    browUp:blend(blendshapes,'browInnerUp'),browDown:(blend(blendshapes,'browDownLeft')+blend(blendshapes,'browDownRight'))/2,
    sneer:(blend(blendshapes,'noseSneerLeft')+blend(blendshapes,'noseSneerRight'))/2,
    smileAsym:smileRight-smileLeft,frownAsym:frownRight-frownLeft,
  };
}

function updateMushroom(delta){
  if(!renderer)return;
  if(mixer)mixer.update(delta);
  if(!pose||!mushroom||!followRoot){renderer.clear();renderer.render(scene,camera);return;}

  const alpha=.38;
  for(const key of ['x','y','width','roll','yaw','pitch','jaw','blinkLeft','blinkRight','squint','smile','frown','pucker','browUp','browDown','sneer','smileAsym','frownAsym']){
    const target=pose[key]??0;
    smooth[key]=mix(smooth[key],target,alpha);
  }
  const width=canvas.clientWidth,height=canvas.clientHeight;
  const worldWidth=modelSize.x||1.9,worldHeight=modelSize.y||2.05;
  const scale=Math.min(smooth.width*1.48/worldWidth,width*.92/worldWidth,height*1.34/worldHeight);
  const blink=(smooth.blinkLeft+smooth.blinkRight)/2;
  blinkUniform.value=clamp(blink,0,1);
  followRoot.scale.set(scale*(1-Math.abs(smooth.yaw)*.065),scale,scale);
  followRoot.rotation.order='YXZ';
  followRoot.rotation.set(smooth.pitch,smooth.yaw,smooth.roll);
  // Keep the supplied rig's mouth motion: only translate its original jaw joint.
  if(mouthBone){
    mouthBone.position.y=.0898+.149*smooth.jaw+.012*smooth.smile-.012*smooth.frown;
    mouthBone.position.z=.5008-.033*smooth.jaw+.009*smooth.pucker;
  }
  // Anchor the actual rigged mouth to the tracked mouth landmarks instead of centering the whole mesh.
  followRoot.position.set(0,0,0);
  followRoot.updateMatrixWorld(true);
  const mouthAnchor=mouthBone?.getWorldPosition(new THREE.Vector3())??new THREE.Vector3();
  followRoot.position.set(smooth.x-width/2-mouthAnchor.x,height/2-smooth.y-mouthAnchor.y,-mouthAnchor.z);
  followRoot.visible=true;
  renderer.clear();renderer.render(scene,camera);
}

async function startCamera(){
  startButton.disabled=true;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS or localhost.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30,max:30}}});
    video.srcObject=stream;await video.play();document.body.classList.add('live');resize();startRenderLoop();
  }catch(error){console.error(error);startButton.disabled=false;return;}
  const results=await Promise.allSettled([setupMushroom(),setupLandmarker()]);
  const modelResult=results[0],faceResult=results[1];
  if(modelResult.status==='fulfilled')setupMushroomDone=true;else{canvas.dataset.modelError=String(modelResult.reason);console.error(modelResult.reason);}
  if(faceResult.status==='fulfilled'){landmarker=faceResult.value;canvas.dataset.trackerReady='true';}else{canvas.dataset.trackerError=String(faceResult.reason);console.error(faceResult.reason);}
}
let setupMushroomDone=false;

function startRenderLoop(){
  if(frameStarted)return;frameStarted=true;
  const render=now=>{
    if(!video.srcObject){frameStarted=false;return;}
    if(landmarker&&video.readyState>=2&&video.currentTime!==lastVideoTime){
      lastVideoTime=video.currentTime;
      try{const result=landmarker.detectForVideo(video,now);canvas.dataset.faceCount=String(result.faceLandmarks?.length??0);trackFace(result);}catch(error){canvas.dataset.trackError=String(error);console.error(error);}
    }
    const delta=Math.min((now-lastFrameTime)/1000,.05);lastFrameTime=now;
    if(setupMushroomDone)updateMushroom(delta);
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}

startButton.addEventListener('click',startCamera);
window.addEventListener('resize',resize);
window.addEventListener('beforeunload',()=>video.srcObject?.getTracks().forEach(track=>track.stop()));
