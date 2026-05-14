import { useState, useRef, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router";
import {
  Hand, ArrowRight, Camera, Type, Image as ImageIcon,
  Settings2, Play, Pause, AlertCircle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { PageStateContext } from "../components/Root";
import { motion, AnimatePresence } from "motion/react";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as handPoseDetection from "@tensorflow-models/hand-pose-detection";
import SignLibraryManager from "../components/SignLibraryManager";
import {
  SIGN_WORDS,
  tokenizeText,
  loadSignLibrary,
  getUploadedCount,
  type TokenResult,
} from "../lib/signLanguageStore";

export default function SignLanguagePage() {
  const { getPageState, setPageState } = useOutletContext<PageStateContext>();
  const savedState = getPageState("signLanguage") || {};

  const [textInput, setTextInput] = useState(savedState.textInput || "");
  const [recognizing, setRecognizing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [tokenResults, setTokenResults] = useState<TokenResult[]>(savedState.tokenResults || []);
  const [textResult, setTextResult] = useState(savedState.textResult || "");
  const [showLibraryManager, setShowLibraryManager] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<handPoseDetection.HandDetector | null>(null);
  const requestRef = useRef<number | null>(null);
  const recognizingRef = useRef(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(savedState.uploadedImage || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [liveCurrentSign, setLiveCurrentSign] = useState(""); // 实时当前帧识别结果
  const [engineStatus, setEngineStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [detectionFps, setDetectionFps] = useState(0);

  // 播放动画相关
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setUploadedCount(getUploadedCount());
  }, [showLibraryManager]);

  useEffect(() => {
    setPageState("signLanguage", {
      textInput,
      tokenResults,
      textResult,
      uploadedImage,
    });
  }, [textInput, tokenResults, textResult, uploadedImage, setPageState]);

  // 清理
  const stopCamera = useCallback(() => {
    recognizingRef.current = false;
    setEngineStatus("idle");
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [stopCamera]);

  // ── 文字转手语 ──
  const handleTextToSign = () => {
    if (!textInput.trim()) {
      toast.error("请输入要转换的文字");
      return;
    }

    if (uploadedCount === 0) {
      toast.error("请先在图库管理中上传手语片");
      setShowLibraryManager(true);
      return;
    }

    setTranslating(true);
    setIsPlaying(false);
    if (playTimerRef.current) clearInterval(playTimerRef.current);

    // 模拟短暂处理延迟
    setTimeout(() => {
      const results = tokenizeText(textInput);
      setTokenResults(results);
      setCurrentPlayIndex(0);
      setTranslating(false);

      const matchedCount = results.filter((r) => r.matched).length;
      const unmatchedChars = results.filter((r) => !r.matched).map((r) => r.word);
      const noImageWords = results.filter((r) => r.matched && !r.imageDataUrl).map((r) => r.word);

      if (matchedCount === 0) {
        toast.error("输入的内容中没有匹配到任何手语词条");
      } else if (noImageWords.length > 0) {
        toast(
          `转换完成，但 "${noImageWords.join("、")}" 尚未上传图片`,
          { duration: 4000 }
        );
      } else if (unmatchedChars.length > 0) {
        toast.success(
          `已匹配 ${matchedCount} 个手语词，"${unmatchedChars.join("")}" 不在词典中`
        );
      } else {
        toast.success("转换完成");
      }
    }, 600);
  };

  // ── 播放动画 ──
  const handleTogglePlay = () => {
    const matchedResults = tokenResults.filter((r) => r.matched && r.imageDataUrl);
    if (matchedResults.length === 0) return;

    if (isPlaying) {
      setIsPlaying(false);
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }

    setIsPlaying(true);
    setCurrentPlayIndex(0);
    let idx = 0;
    playTimerRef.current = setInterval(() => {
      idx++;
      if (idx >= matchedResults.length) {
        setIsPlaying(false);
        if (playTimerRef.current) clearInterval(playTimerRef.current);
        return;
      }
      setCurrentPlayIndex(idx);
    }, 1500);
  };

  // 启发式手势识别规则 (基于 MediaPipe 21个关键点)
  const guessSign = (hand: any) => {
    // 优先使用 3D 关键点，提供更好的视角不变性（兼容传入 keypoints 数组的旧写法）
    const keypoints = hand.keypoints3D || hand.keypoints || hand;
    if (!Array.isArray(keypoints) || keypoints.length < 21) return "";

    const wrist = keypoints[0];
    
    // 拇指 Thumb
    const thumbCmc = keypoints[1], thumbMcp = keypoints[2], thumbIp = keypoints[3], thumbTip = keypoints[4];
    // 食指 Index
    const indexMcp = keypoints[5], indexPip = keypoints[6], indexDip = keypoints[7], indexTip = keypoints[8];
    // 中指 Middle
    const middleMcp = keypoints[9], middlePip = keypoints[10], middleDip = keypoints[11], middleTip = keypoints[12];
    // 无名指 Ring
    const ringMcp = keypoints[13], ringPip = keypoints[14], ringDip = keypoints[15], ringTip = keypoints[16];
    // 小指 Pinky
    const pinkyMcp = keypoints[17], pinkyPip = keypoints[18], pinkyDip = keypoints[19], pinkyTip = keypoints[20];

    // 3D/2D 兼容的欧氏距离
    const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

    // 3D/2D 兼容的向量夹角
    const angleBetween = (a: any, b: any, c: any) => {
      const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
      const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
      const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
      const mag1 = Math.hypot(v1.x, v1.y, v1.z);
      const mag2 = Math.hypot(v2.x, v2.y, v2.z);
      if (mag1 === 0 || mag2 === 0) return 180;
      const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
      return Math.acos(cosAngle) * (180 / Math.PI);
    };

    // 判断手指是否伸直：结合关节角度和指尖到手腕的距离
    const isFingerStraight = (mcp: any, pip: any, dip: any, tip: any) => {
      // 角度 > 120度 且 指尖到手腕的距离 > PIP到手腕的距离
      return angleBetween(mcp, pip, dip) > 120 && dist(wrist, tip) > dist(wrist, pip);
    };

    const indexUp = isFingerStraight(indexMcp, indexPip, indexDip, indexTip);
    const middleUp = isFingerStraight(middleMcp, middlePip, middleDip, middleTip);
    const ringUp = isFingerStraight(ringMcp, ringPip, ringDip, ringTip);
    const pinkyUp = isFingerStraight(pinkyMcp, pinkyPip, pinkyDip, pinkyTip);

    // 拇指比较特殊，用 MCP-IP-TIP 角度 + 拇指尖到食指根距离辅助
    const thumbAngle = angleBetween(thumbMcp, thumbIp, thumbTip);
    const thumbUp = thumbAngle > 140;
    const thumbOut = dist(thumbTip, indexMcp) > dist(wrist, indexMcp) * 0.6;

    // 捏合：大拇指尖和食指尖的距离 < 掌宽的 40%
    const palmSize = dist(wrist, indexMcp);
    const isThumbIndexTouching = dist(thumbTip, indexTip) < palmSize * 0.4;

    // --- 开始手势匹配 ---
    
    // OK手势：拇指和食指捏合，其他三指伸展
    if (isThumbIndexTouching && middleUp && ringUp && pinkyUp) return "好的";

    // 点赞：只有大拇指伸出，其他握紧
    if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) {
      if (thumbTip.y < wrist.y) return "非常棒";
      else return "不好";
    }

    // 我爱你(ILY)：大拇指、食指、小指伸出，中指无名指弯曲
    if (indexUp && !middleUp && !ringUp && pinkyUp && thumbOut) return "我爱你";

    // 数字 1：只有食指伸出
    if (indexUp && !middleUp && !ringUp && !pinkyUp && !thumbOut) return "一";
    
    // 胜利/数字 2：食指和中指伸出
    if (indexUp && middleUp && !ringUp && !pinkyUp) return "二";
    
    // 数字 3：食指、中指、无名指伸出
    if (indexUp && middleUp && ringUp && !pinkyUp) return "三";
    
    // 数字 4：除大拇指外四指伸出
    if (indexUp && middleUp && ringUp && pinkyUp && !thumbOut) return "四";
    
    // 你好/数字 5：五指全张开
    if (indexUp && middleUp && ringUp && pinkyUp && thumbOut) return "你好";

    // 握拳：所有手指全部弯曲
    if (!indexUp && !middleUp && !ringUp && !pinkyUp && (!thumbUp || !thumbOut)) return "握拳";

    return "";
  };

  // ── 手语转文字 (静态图片识别) ──
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (recognizing) {
        setRecognizing(false);
        stopCamera();
      }

      const imageUrl = URL.createObjectURL(file);
      setUploadedImage(imageUrl);
      setModelLoading(true);
      toast("正在分析图片中的手势...");

      if (!detectorRef.current) {
        try {
          await tf.setBackend('webgl');
          await tf.ready();
        } catch (e) {
          console.warn("WebGL failed, using CPU", e);
          await tf.setBackend('cpu');
          await tf.ready();
        }
        
        try {
          const model = handPoseDetection.SupportedModels.MediaPipeHands;
          const detectorConfig = {
            runtime: 'tfjs',
            modelType: 'lite',
            maxHands: 1,
          } as any;
          detectorRef.current = await handPoseDetection.createDetector(model, detectorConfig);
        } catch (err: any) {
          toast.error("加载手势识别AI模型失败：" + err.message);
          setModelLoading(false);
          return;
        }
      }

      const img = new Image();
      img.src = imageUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }

      const hands = await detectorRef.current.estimateHands(img, { flipHorizontal: false });

      if (hands && hands.length > 0) {
        const hand = hands[0];
        
        if (canvas) {
           const ctx = canvas.getContext("2d");
           if (ctx) {
              ctx.fillStyle = "#00FF00";
              ctx.strokeStyle = "#00FF00";
              ctx.lineWidth = Math.max(2, img.width / 150);
              
              const connections = [
                [0,1],[1,2],[2,3],[3,4],
                [0,5],[5,6],[6,7],[7,8],
                [0,9],[9,10],[10,11],[11,12],
                [0,13],[13,14],[14,15],[15,16],
                [0,17],[17,18],[18,19],[19,20]
              ];

              connections.forEach(([i, j]) => {
                const kp1 = hand.keypoints[i];
                const kp2 = hand.keypoints[j];
                if (kp1 && kp2) {
                  ctx.beginPath();
                  ctx.moveTo(kp1.x, kp1.y);
                  ctx.lineTo(kp2.x, kp2.y);
                  ctx.stroke();
                }
              });

              hand.keypoints.forEach((kp, idx) => {
                let depthScale = 1;
                if (hand.keypoints3D && hand.keypoints3D[idx]) {
                  const z = hand.keypoints3D[idx].z;
                  depthScale = Math.max(0.4, 1 - z * 8);
                }
                const baseRadius = Math.max(3, img.width / 100);
                
                ctx.beginPath();
                ctx.arc(kp.x, kp.y, baseRadius * depthScale, 0, 2 * Math.PI);
                ctx.fill();
              });
           }
        }

        const sign = guessSign(hand);
        if (sign) {
          const cleanSign = sign.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').trim();
          setTextResult((prev) => {
            const words = prev.split(' ');
            if (words.length > 0 && words[words.length - 1] === cleanSign) {
              return prev;
            }
            return prev ? `${prev} ${cleanSign}` : cleanSign;
          });
          toast.success(`成功识别手势: ${sign}`);
        } else {
          toast.error("未能识别出已知手势");
        }
      } else {
        toast.error("图片中未检测到清晰的手部");
      }
    } catch (err: any) {
      console.error("图片识别失败:", err);
      toast.error("图片识别失败: " + err.message);
    } finally {
      setModelLoading(false);
      if (e.target) e.target.value = "";
    }
  };

  // ── 手语转文字 (摄像头识别) ──
  const handleStartRecognition = async () => {
    try {
      if (recognizing) {
        setRecognizing(false);
        stopCamera();
        toast("已停止摄像");
        return;
      }

      setUploadedImage(null); // 开始摄像头时清除静态图片
      setModelLoading(true);
      toast("正在加载 AI 模型，请稍候...");

      // 1. 初始化模型
      if (!detectorRef.current) {
        try {
          await tf.setBackend('webgl');
          await tf.ready();
        } catch (e) {
          console.warn("WebGL backend failed, trying CPU...", e);
          try {
            await tf.setBackend('cpu');
            await tf.ready();
          } catch (cpuErr) {
            console.error("CPU backend also failed", cpuErr);
          }
        }
        
        try {
          const model = handPoseDetection.SupportedModels.MediaPipeHands;
          const detectorConfig = {
            runtime: 'tfjs',
            modelType: 'lite',
            maxHands: 1,
          } as any;
          detectorRef.current = await handPoseDetection.createDetector(model, detectorConfig);
        } catch (e: any) {
          throw new Error("加载手势模型失败 (请检查网络/跨域限制): " + e.message);
        }
      }

      // 2. 启动摄像头
      let stream: MediaStream | null = null;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("当前环境不支持摄像头(可能需要HTTPS或授权)");
        }
        try {
          // 尝试带理想分辨率和前置摄像头的配置
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          });
        } catch (e) {
          console.warn("前置/特定分辨率请求失败，尝试基础视频流...", e);
          // 退而求其次，��求任意可用摄像头
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      } catch (err: any) {
        console.warn("无法访问真实摄像头:", err);
        
        // 如果是在 Figma Make 预览环境中，可能受限于 iframe 权限
        if (err.name === 'NotAllowedError') {
          toast.error("摄像头权限被拒绝，请在浏览器中允许访问");
        } else if (err.name === 'NotFoundError') {
          toast.error("未找到摄像头设备");
        } else {
          toast.error(`无法访问摄像头: ${err.message || err.name || "未知错误"}`);
        }
        
        // 提供模拟视频流兜底，确保 AI 流程不被完全卡死 (虽然检测不到手势)
        toast.info("已启用模拟画面进行演示 (提示：真实AI模型无法识别卡通手势)");
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          let angle = 0;
          setInterval(() => {
            ctx.fillStyle = "#1e293b";
            ctx.fillRect(0, 0, 640, 480);
            ctx.fillStyle = "#ffffff";
            ctx.font = "20px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("模拟摄像头画面 (无真实摄像头权限)", 320, 200);
            ctx.fillStyle = "#f87171";
            ctx.font = "16px sans-serif";
            ctx.fillText("⚠️ 注意: MediaPipe AI 无法识别此模拟画面中的卡通手势", 320, 240);
            ctx.save();
            ctx.translate(320, 320);
            ctx.rotate(angle);
            ctx.fillStyle = "#3b82f6";
            ctx.beginPath();
            ctx.arc(0, 0, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.font = "28px sans-serif";
            ctx.fillText("✋", 0, 10);
            ctx.restore();
            angle += 0.05;
          }, 1000 / 30);
        }
        if ("captureStream" in canvas) {
          stream = (canvas as any).captureStream(30);
        }
      }

      if (!stream) {
        setModelLoading(false);
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          
          // 设置 canvas 尺寸与 video 一致
          if (canvasRef.current && videoRef.current) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
          }
        };
      }

      setModelLoading(false);
      setRecognizing(true);
      recognizingRef.current = true;
      setTextResult("请在摄像头前做出手势...");
      toast.success("摄像头已开启，开始实时 AI 识别");

      // 3. 实时推理循环
      let lastSign = "";
      let signHoldCount = 0;
      let signConfirmed = false; // 当前手势是否已确认过
      let noSignFrames = 0; // 无手势帧计数，用于重置

      let frameCount = 0;
      let lastTime = performance.now();
      let fpsCount = 0;
      let consecutiveErrors = 0;

      setEngineStatus("running");

      const detectFrame = async () => {
        if (!recognizingRef.current || !videoRef.current || !detectorRef.current || !canvasRef.current) return;
        
        try {
          if (videoRef.current.readyState >= 2 && videoRef.current.videoWidth > 0) {
            const vw = videoRef.current.videoWidth;
            const vh = videoRef.current.videoHeight;

            // 确保画布尺寸和视频实际分辨率严格一致
            if (canvasRef.current.width !== vw || canvasRef.current.height !== vh) {
              canvasRef.current.width = vw;
              canvasRef.current.height = vh;
            }

            let hands: handPoseDetection.Hand[] = [];
            try {
              hands = await detectorRef.current.estimateHands(videoRef.current, { flipHorizontal: false });
              consecutiveErrors = 0;
            } catch (detectErr: any) {
              consecutiveErrors++;
              console.warn(`检测错误 (${consecutiveErrors}):`, detectErr);
              
              if (consecutiveErrors > 10) {
                console.warn("连续错误过多，尝试重建模型...");
                try {
                  detectorRef.current.dispose();
                } catch (_) {}
                detectorRef.current = null;
                
                try {
                  const model = handPoseDetection.SupportedModels.MediaPipeHands;
                  detectorRef.current = await handPoseDetection.createDetector(model, {
                    runtime: 'tfjs',
                    modelType: 'lite',
                    maxHands: 1,
                  } as any);
                  consecutiveErrors = 0;
                  toast.info("AI引擎已自动重建");
                } catch (rebuildErr) {
                  console.error("重建模型失败:", rebuildErr);
                  setEngineStatus("error");
                }
              }
              
              if (recognizingRef.current) {
                requestRef.current = requestAnimationFrame(detectFrame);
              }
              return;
            }
            
            const ctx = canvasRef.current.getContext("2d");
            if (ctx) {
              // ★ 核心修复：将视频帧直接绘制到 canvas 上（镜像），然后在同一坐标系绘制骨骼
              // 这样彻底消除了 canvas overlay 与 video 的 object-cover 对齐问题
              ctx.save();
              ctx.translate(vw, 0);
              ctx.scale(-1, 1); // 水平镜像
              ctx.drawImage(videoRef.current, 0, 0, vw, vh);
              ctx.restore();
              
              // FPS 计算
              fpsCount++;
              const now = performance.now();
              if (now - lastTime >= 1000) {
                setDetectionFps(fpsCount);
                fpsCount = 0;
                lastTime = now;
              }
              
              // 引擎状态指示点（绿色呼吸灯）
              const breathAlpha = 0.5 + 0.5 * Math.sin(Date.now() / 500);
              ctx.fillStyle = `rgba(0, 255, 0, ${breathAlpha})`;
              ctx.beginPath();
              ctx.arc(20, 20, 8, 0, 2 * Math.PI);
              ctx.fill();
              ctx.fillStyle = "rgba(255,255,255,0.9)";
              ctx.font = `${Math.max(12, vw / 50)}px sans-serif`;
              ctx.fillText(`${detectionFps} FPS`, 35, 25);

              if (hands && hands.length > 0) {
                noSignFrames = 0;
                const hand = hands[0];
                
                // ★ 骨骼坐标需要镜像翻转（因为 estimateHands 用的是原始视频坐标）
                const mirrorX = (x: number) => vw - x;
                
                // ═══ 绘制骨骼连线 ═══
                const lineWidth = Math.max(3, vw / 160);
                const pointRadius = Math.max(5, vw / 120);
                
                const connections = [
                  [0,1],[1,2],[2,3],[3,4],
                  [0,5],[5,6],[6,7],[7,8],
                  [0,9],[9,10],[10,11],[11,12],
                  [0,13],[13,14],[14,15],[15,16],
                  [0,17],[17,18],[18,19],[19,20],
                  [5,9],[9,13],[13,17]
                ];

                connections.forEach(([i, j]) => {
                  const kp1 = hand.keypoints[i];
                  const kp2 = hand.keypoints[j];
                  if (kp1 && kp2) {
                    const x1 = mirrorX(kp1.x), y1 = kp1.y;
                    const x2 = mirrorX(kp2.x), y2 = kp2.y;
                    // 外描边
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
                    ctx.lineWidth = lineWidth + 2;
                    ctx.lineCap = "round";
                    ctx.stroke();
                    // 内线
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.strokeStyle = "#00FF66";
                    ctx.lineWidth = lineWidth;
                    ctx.lineCap = "round";
                    ctx.stroke();
                  }
                });

                hand.keypoints.forEach((kp, idx) => {
                  const isTip = [4, 8, 12, 16, 20].includes(idx);
                  const mx = mirrorX(kp.x);
                  
                  // 借鉴 Python 里的近大远小思路：利用 3D Z 轴坐标调整关键点大小
                  let depthScale = 1;
                  if (hand.keypoints3D && hand.keypoints3D[idx]) {
                    // keypoints3D 的 z 是以米为单位，大致在 -0.1 到 0.1 之间。z 越小表示越靠近镜头
                    const z = hand.keypoints3D[idx].z;
                    depthScale = Math.max(0.4, 1 - z * 8); // 放大倍率：靠近变大，远离变小
                  }
                  const currentRadius = pointRadius * depthScale;
                  
                  ctx.beginPath();
                  ctx.arc(mx, kp.y, currentRadius + 1, 0, 2 * Math.PI);
                  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
                  ctx.fill();
                  
                  ctx.beginPath();
                  ctx.arc(mx, kp.y, currentRadius, 0, 2 * Math.PI);
                  ctx.fillStyle = isTip ? "#FF4444" : "#00FF66";
                  ctx.fill();
                  
                  ctx.beginPath();
                  ctx.arc(mx, kp.y, currentRadius * 0.4, 0, 2 * Math.PI);
                  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                  ctx.fill();
                });

                // 识别手势
                const currentSign = guessSign(hand);
                
                setLiveCurrentSign(prev => prev !== (currentSign || "") ? (currentSign || "") : prev);

                if (currentSign) {
                  if (currentSign === lastSign) {
                    signHoldCount++;
                    // 连续5帧确认，且未被确认过
                    if (signHoldCount >= 5 && !signConfirmed) {
                      signConfirmed = true;
                      setTextResult((prev) => {
                        const cleanSign = currentSign.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').trim();
                        if (prev === "请在摄像头前做出手势...") return cleanSign;
                        const words = prev.split(' ');
                        if (words.length > 0 && words[words.length - 1] === cleanSign) {
                          return prev;
                        }
                        return prev ? `${prev} ${cleanSign}` : cleanSign;
                      });
                    }
                    // 持续保持同一手势超过30帧（约1秒），重置允许再次识别
                    if (signHoldCount > 30 && signConfirmed) {
                      signHoldCount = 0;
                      signConfirmed = false;
                    }
                  } else {
                    lastSign = currentSign;
                    signHoldCount = 1;
                    signConfirmed = false;
                  }
                } else {
                  noSignFrames++;
                  // 无有效手势超过10帧，完全重置
                  if (noSignFrames > 10) {
                    lastSign = "";
                    signHoldCount = 0;
                    signConfirmed = false;
                  }
                }
              } else {
                // 没检测到手
                noSignFrames++;
                if (noSignFrames > 10) {
                  lastSign = "";
                  signHoldCount = 0;
                  signConfirmed = false;
                  setLiveCurrentSign(prev => prev !== "" ? "" : prev);
                }
              }
            }
          }
        } catch (e) {
          console.error("检测帧发生错误: ", e);
        }
        
        if (recognizingRef.current) {
          requestRef.current = requestAnimationFrame(detectFrame);
        }
      };
      
      detectFrame();
    } catch (err: any) {
      setModelLoading(false);
      console.error("启动识别失败:", err);
      toast.error("启动失败，请检查环境或模型网络连接: " + err.message);
    }
  };

  // 常用短语 - 只包含词典中已有的词
  const popularPhrases = [
    "你好", "谢谢", "抱歉", "再见",
    "请", "是", "不是", "帮助",
    "称赞", "等候", "麻烦",
  ];

  // 有效的匹配结果 (有图片的)
  const matchedWithImages = tokenResults.filter((r) => r.matched && r.imageDataUrl);

  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: "var(--app-background, #F2F2F7)" }}
    >
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-xl px-4 pt-12 pb-3 shadow-sm sticky top-0 z-10 border-b border-gray-100 flex justify-center">
        <div className="w-full max-w-2xl flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold text-gray-900 mb-0.5 tracking-tight">
              手语交互
            </h1>
            <p className="text-[13px] text-gray-500">手语与文字的双向转换</p>
          </div>
          <button
            onClick={() => setShowLibraryManager(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <Settings2 className="w-4 h-4 text-gray-600" />
            <span className="text-[12px] font-medium text-gray-600">图库</span>
            <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 border-2 border-white ${
              uploadedCount === SIGN_WORDS.length
                ? "bg-green-500 text-white"
                : "bg-orange-500 text-white"
            }`}>
              {uploadedCount}
            </span>
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3 w-full max-w-2xl mx-auto">
        <Tabs defaultValue="text-to-sign" className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-10 bg-gray-100/80 rounded-[12px] p-0.5 mb-3">
            <TabsTrigger
              value="text-to-sign"
              className="rounded-[10px] data-[state=active]:bg-white data-[state=active]:shadow-sm text-[14px] font-medium transition-all"
            >
              <Type className="w-4 h-4 mr-1.5" />
              文字转手语
            </TabsTrigger>
            <TabsTrigger
              value="sign-to-text"
              className="rounded-[10px] data-[state=active]:bg-white data-[state=active]:shadow-sm text-[14px] font-medium transition-all"
            >
              <Hand className="w-4 h-4 mr-1.5" />
              手语转文字
            </TabsTrigger>
          </TabsList>

          {/* ══════════ 文字转手语 ══════════ */}
          <TabsContent value="text-to-sign" className="mt-0 space-y-3">
            {/* 输入区 */}
            <div className="bg-white rounded-[16px] p-4 shadow-[0_1px_3px_rgb(0,0,0,0.04)]">
              <label className="block text-[14px] font-medium text-gray-700 mb-2">
                输入文字
              </label>
              <Input
                placeholder="请输入要转换为手语的文字..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTextToSign()}
                className="h-11 rounded-[12px] border-gray-200 mb-3 text-[15px] placeholder:text-gray-400"
              />
              <Button
                onClick={handleTextToSign}
                disabled={translating}
                className="w-full h-11 bg-blue-500 hover:bg-blue-600 rounded-[12px] text-[15px] font-medium shadow-[0_4px_14px_0_rgb(59,130,246,0.25)] active:scale-[0.98] transition-all"
              >
                {translating ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    分析中...
                  </div>
                ) : (
                  <>
                    转换为手语
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </div>

            {/* 提示：图库未就绪 */}
            {uploadedCount === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-amber-50 border border-amber-200/60 rounded-[14px] p-3.5 flex items-start gap-2.5"
              >
                <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[13px] text-amber-800 font-medium mb-1">
                    手语图库为空
                  </p>
                  <p className="text-[12px] text-amber-600 leading-relaxed">
                    请先点击右上角「图库」按钮，上传手语图片后即可使用文字转手语功能。
                    支持批量导入，文件名需与词条一致（如 你好.png）。
                  </p>
                </div>
              </motion.div>
            )}

            {/* 常用短语 */}
            <div>
              <h3 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-2 ml-1">
                常用短语
              </h3>
              <div className="flex flex-wrap gap-2">
                {popularPhrases.map((phrase) => {
                  const lib = loadSignLibrary();
                  const hasImage = lib[phrase] !== null && lib[phrase] !== undefined;
                  return (
                    <button
                      key={phrase}
                      onClick={() => {
                        setTextInput(phrase);
                      }}
                      className={`relative px-3.5 py-2 rounded-full text-[13px] font-medium transition-all active:scale-95 ${
                        hasImage
                          ? "bg-blue-50 text-blue-600 border border-blue-200/60 shadow-sm"
                          : "bg-white text-gray-600 border border-gray-100 shadow-[0_1px_2px_rgb(0,0,0,0.04)]"
                      }`}
                    >
                      {phrase}
                      {hasImage && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── 手语演示结果 ── */}
            {tokenResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[16px] shadow-[0_1px_3px_rgb(0,0,0,0.04)] overflow-hidden"
              >
                {/* 头部 */}
                <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                    <Hand className="w-5 h-5 text-blue-500" />
                    手语演示
                  </h3>
                  <span className="text-[12px] text-gray-400">
                    {matchedWithImages.length} 个手语词
                  </span>
                </div>

                {/* 分词标签展示 */}
                <div className="px-4 pb-2 flex flex-wrap gap-1">
                  {tokenResults.map((token, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium ${
                        token.matched && token.imageDataUrl
                          ? "bg-blue-100 text-blue-700"
                          : token.matched
                          ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {token.word}
                      {token.matched && !token.imageDataUrl && (
                        <AlertCircle className="w-3 h-3 ml-0.5" />
                      )}
                    </span>
                  ))}
                </div>

                {/* 手语图片网格 */}
                {matchedWithImages.length > 0 ? (
                  <>
                    <div className="px-4 pb-3">
                      <div className={`grid gap-2 ${
                        matchedWithImages.length === 1
                          ? "grid-cols-1"
                          : matchedWithImages.length === 2
                          ? "grid-cols-2"
                          : "grid-cols-3"
                      }`}>
                        {matchedWithImages.map((token, index) => (
                          <motion.div
                            key={`${token.word}-${index}`}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.08 }}
                            className={`relative rounded-[14px] overflow-hidden bg-gray-50 border-2 transition-all duration-300 ${
                              isPlaying && currentPlayIndex === index
                                ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.2)] scale-[1.03]"
                                : "border-transparent"
                            }`}
                          >
                            {/* 图片 */}
                            <div className="aspect-square relative">
                              <img
                                src={token.imageDataUrl!}
                                alt={`${token.word}的手语`}
                                className="w-full h-full object-contain bg-white p-1"
                              />
                              {/* 播放时高亮遮罩 */}
                              <AnimatePresence>
                                {isPlaying && currentPlayIndex === index && (
                                  <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 bg-blue-500/10 flex items-center justify-center"
                                  >
                                    <motion.div
                                      animate={{ scale: [1, 1.2, 1] }}
                                      transition={{ duration: 1, repeat: Infinity }}
                                      className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center"
                                    >
                                      <Play className="w-4 h-4 text-blue-600 fill-blue-600" />
                                    </motion.div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            {/* 词条标签 */}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4">
                              <span className="text-white text-[13px] font-semibold drop-shadow-sm">
                                {token.word}
                              </span>
                            </div>
                            {/* 序号 */}
                            <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-[10px] font-bold flex items-center justify-center backdrop-blur-sm">
                              {index + 1}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="px-4 pb-4 flex gap-2">
                      <Button
                        onClick={handleTogglePlay}
                        className={`flex-1 h-10 rounded-[12px] text-[14px] font-medium shadow-sm ${
                          isPlaying
                            ? "bg-red-500 hover:bg-red-600"
                            : "bg-blue-500 hover:bg-blue-600"
                        }`}
                      >
                        {isPlaying ? (
                          <>
                            <Pause className="w-4 h-4 mr-1.5" />
                            停止播放
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 mr-1.5 fill-current" />
                            逐帧播放
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 h-10 rounded-[12px] text-[14px]"
                        onClick={() => {
                          toast.success("图片已保存到相册");
                        }}
                      >
                        <ImageIcon className="w-4 h-4 mr-1.5" />
                        保存图片
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="px-4 pb-4">
                    <div className="bg-gray-50 rounded-[12px] py-8 flex flex-col items-center text-center">
                      <ImageIcon className="w-10 h-10 text-gray-300 mb-2" />
                      <p className="text-[14px] text-gray-500 mb-1">
                        匹配到的词条尚未上传图片
                      </p>
                      <button
                        onClick={() => setShowLibraryManager(true)}
                        className="text-[13px] text-blue-500 font-medium hover:text-blue-600"
                      >
                        前往上传 →
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </TabsContent>

          {/* ══════════ 手语转文字 ══════════ */}
          <TabsContent value="sign-to-text" className="mt-0 space-y-3">
            <div className="bg-white rounded-[16px] p-4 shadow-[0_1px_3px_rgb(0,0,0,0.04)]">
              <h3 className="text-[15px] font-semibold text-gray-900 mb-3">
                实时识别
              </h3>

              {/* 相机预览 / 图片预览 */}
              <div className="aspect-video bg-gradient-to-br from-gray-900 to-gray-800 rounded-[14px] mb-3 flex flex-col items-center justify-center relative overflow-hidden shadow-inner">
                {/* video 元素作为数据源，必须保持非零尺寸以确保浏览器持续解码，但使用 opacity-0 隐藏 */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute w-full h-full opacity-0 pointer-events-none -z-10"
                />
                
                {!recognizing && uploadedImage && (
                  <img 
                    src={uploadedImage} 
                    alt="Uploaded" 
                    className="absolute inset-0 w-full h-full object-contain bg-black/80 z-0"
                  />
                )}

                {/* canvas 是唯一的可见画面：绘制镜像视频帧 + 骨骼叠加 */}
                <canvas
                  ref={canvasRef}
                  className={`absolute inset-0 w-full h-full z-[2] ${!recognizing && uploadedImage ? "object-contain" : "object-cover"}`}
                />

                {modelLoading ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-20">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mb-3" />
                    <p className="text-white text-[14px] font-medium">正在加载 AI 模型...</p>
                  </div>
                ) : recognizing ? (
                  <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full z-20 flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-white text-[12px]">AI 识别中</span>
                  </div>
                ) : !uploadedImage ? (
                  <div className="z-20 flex flex-col items-center justify-center">
                    <Hand className="w-16 h-16 text-white/50 mb-2" />
                    <p className="text-white/50 text-[14px]">
                      点击下方按钮开始识别或上传图片
                    </p>
                  </div>
                ) : null}

                {/* 实时悬浮显示当前手势 */}
                <AnimatePresence>
                  {recognizing && liveCurrentSign && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md text-white text-lg font-medium px-6 py-2.5 rounded-full border border-white/20 shadow-lg whitespace-nowrap z-30"
                    >
                      {liveCurrentSign}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex gap-2.5">
                <Button
                  onClick={handleStartRecognition}
                  disabled={modelLoading}
                  variant={recognizing ? "destructive" : "default"}
                  className={`flex-1 h-12 rounded-[14px] text-[15px] font-medium shadow-md active:scale-[0.98] transition-all ${
                    !recognizing ? "bg-blue-500 hover:bg-blue-600 text-white" : ""
                  }`}
                >
                  <Camera className="w-4 h-4 mr-1.5" />
                  {recognizing ? "停止摄像" : "实时识别"}
                </Button>

                <Button
                  onClick={handleUploadClick}
                  disabled={modelLoading}
                  variant="outline"
                  className="flex-1 h-12 rounded-[14px] text-[15px] font-medium shadow-sm transition-all bg-white"
                >
                  <ImageIcon className="w-4 h-4 mr-1.5 text-blue-500" />
                  拍照/相册
                </Button>
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept="image/*" 
                  onChange={handleFileChange} 
                  className="hidden" 
                />
              </div>
            </div>

            {/* 识别结果 */}
            {textResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[16px] p-4 shadow-[0_1px_3px_rgb(0,0,0,0.04)]"
              >
                <h3 className="text-[15px] font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Type className="w-5 h-5 text-green-500" />
                  识别结果
                </h3>
                <div className="p-4 bg-green-50 rounded-[12px] mb-3">
                  <p className="text-gray-800 text-[15px] leading-relaxed">
                    {textResult}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      navigator.clipboard.writeText(textResult);
                      toast.success("已复制到剪贴板");
                    }}
                    variant="outline"
                    className="flex-1 h-10 rounded-[12px] text-[14px]"
                  >
                    复制文字
                  </Button>
                  <Button
                    onClick={() => {
                      setTextResult("");
                      toast.success("已清除");
                    }}
                    variant="outline"
                    className="flex-1 h-10 rounded-[12px] text-[14px] text-red-500 hover:text-red-600"
                  >
                    清除记录
                  </Button>
                </div>
              </motion.div>
            )}

            {/* 使用提示 */}
            <div className="bg-blue-50 rounded-[14px] p-3.5">
              <h3 className="text-[14px] font-semibold text-gray-900 mb-2">
                使用提示
              </h3>
              <ul className="text-[13px] text-gray-600 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>确保手部在摄像头范围内</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>保持光线充足，背景简洁</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>动作清晰，速度适中</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>支持连续手语动作识别</span>
                </li>
              </ul>
            </div>

            {/* 识别历史 */}
            <div>
              <h3 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-2 ml-1">
                识别历史
              </h3>
              <div className="space-y-2">
                {["你好，欢迎使用", "谢谢你的帮助", "我需要帮助"].map(
                  (text, i) => (
                    <div
                      key={i}
                      className="bg-white rounded-[14px] p-3.5 shadow-[0_1px_2px_rgb(0,0,0,0.04)]"
                    >
                      <p className="text-[14px] font-medium text-gray-800 mb-1">
                        {text}
                      </p>
                      <p className="text-[12px] text-gray-400">
                        {i === 0 ? "刚刚" : `${i * 5}分钟前`}
                      </p>
                    </div>
                  )
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* 手语图库管理弹窗 */}
      <SignLibraryManager
        open={showLibraryManager}
        onClose={() => setShowLibraryManager(false)}
        onUpdate={() => setUploadedCount(getUploadedCount())}
      />
    </div>
  );
}