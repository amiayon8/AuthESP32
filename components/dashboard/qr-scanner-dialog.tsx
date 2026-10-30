"use client";

import * as React from "react";
import jsQR from "jsqr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Camera,
  X,
  Upload,
  Flashlight,
  FlashlightOff,
  CheckCircle2,
  AlertCircle,
  Cpu,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { UiAccount, UiDevice } from "./types";
import { parseOtpAuthUri } from "@/lib/validation/otp-uri";

interface QrScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: UiDevice[];
  onAccountCreated: (account: UiAccount) => void;
}

export function QrScannerDialog({
  open,
  onOpenChange,
  devices,
  onAccountCreated,
}: QrScannerDialogProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);

  const [hasCamera, setHasCamera] = React.useState(true);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = React.useState(false);
  const [torchOn, setTorchOn] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string>("none");
  const [detectedUri, setDetectedUri] = React.useState<string | null>(null);
  const [scannedDetails, setScannedDetails] = React.useState<{
    issuer?: string | null;
    account: string;
    secret: string;
    algorithm: "SHA1" | "SHA256" | "SHA512";
    digits: number;
    period: number;
  } | null>(null);

  const stopCamera = React.useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      stopCamera();
      setDetectedUri(null);
      setScannedDetails(null);
      setCameraError(null);
      setProcessing(false);
    }
    onOpenChange(newOpen);
  };

  const handleDecodedString = React.useCallback(
    async (decodedText: string) => {
      if (processing || detectedUri) return;

      const trimmed = decodedText.trim();
      if (!trimmed.startsWith("otpauth://")) {
        toast.error("Scanned QR code is not a standard TOTP authenticator URI");
        return;
      }

      try {
        setProcessing(true);
        const parsed = parseOtpAuthUri(trimmed);
        setDetectedUri(trimmed);
        setScannedDetails({
          issuer: parsed.issuer,
          account: parsed.account,
          secret: parsed.secret,
          algorithm: parsed.algorithm,
          digits: parsed.digits,
          period: parsed.period,
        });
        stopCamera();
        toast.success("QR code recognized successfully");
      } catch (err: any) {
        toast.error(err.message || "Invalid authenticator barcode");
      } finally {
        setProcessing(false);
      }
    },
    [processing, detectedUri, stopCamera]
  );

  const startScanningLoop = React.useCallback(() => {
    const scan = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (qrCode && qrCode.data) {
            handleDecodedString(qrCode.data);
            return;
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(scan);
    };

    animationFrameRef.current = requestAnimationFrame(scan);
  }, [handleDecodedString]);

  const startCamera = React.useCallback(async () => {
    stopCamera();
    setCameraError(null);
    setHasCamera(true);

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
        startScanningLoop();
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities = (videoTrack.getCapabilities?.() || {}) as any;
        if (capabilities.torch) {
          setTorchAvailable(true);
        }
      }
    } catch (err: any) {
      setHasCamera(false);
      setCameraError(
        err.name === "NotAllowedError"
          ? "Camera permission was denied. You can upload a QR image below."
          : "Could not access camera. You can upload a QR code image."
      );
    }
  }, [stopCamera, startScanningLoop]);

  React.useEffect(() => {
    if (open && !detectedUri) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, detectedUri, startCamera, stopCamera]);

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const newStatus = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: newStatus }],
      });
      setTorchOn(newStatus);
    } catch {
      toast.error("Flashlight control failed");
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
          if (qrCode && qrCode.data) {
            handleDecodedString(qrCode.data);
          } else {
            toast.error("No QR code found in selected image");
          }
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmSave = async () => {
    if (!scannedDetails) return;

    setProcessing(true);
    try {
      const displayName = scannedDetails.issuer
        ? `${scannedDetails.issuer} (${scannedDetails.account})`
        : scannedDetails.account;

      const payload = {
        name: displayName,
        issuer: scannedDetails.issuer || undefined,
        accountLabel: scannedDetails.account,
        secret: scannedDetails.secret,
        algorithm: scannedDetails.algorithm,
        digits: scannedDetails.digits,
        period: scannedDetails.period,
        deviceId: selectedDeviceId === "none" ? undefined : selectedDeviceId,
      };

      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to save account");
      }

      const assignedDevice = devices.find((d) => d.id === selectedDeviceId);
      const newAccount: UiAccount = {
        id: json.data.id,
        name: json.data.name,
        issuer: json.data.issuer || scannedDetails.issuer || null,
        account_label: json.data.account_label || scannedDetails.account || null,
        algorithm: json.data.algorithm || scannedDetails.algorithm,
        digits: json.data.digits || scannedDetails.digits,
        period: json.data.period || scannedDetails.period,
        sort_order: json.data.sort_order ?? 0,
        enabled: true,
        created_at: new Date().toISOString(),
        device_id: selectedDeviceId === "none" ? null : selectedDeviceId,
        device_name: assignedDevice?.name || null,
        device_prefix: assignedDevice?.api_key_prefix || null,
        secret: scannedDetails.secret,
      };

      onAccountCreated(newAccount);
      toast.success("Account added from QR code");
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to add account");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#1e1f20] border-[#3c4043] rounded-3xl p-0 overflow-hidden text-[#e3e3e3] shadow-2xl">
        <DialogHeader className="p-4 pb-2 flex flex-row items-center justify-between border-b border-[#282a2c]">
          <DialogTitle className="text-base font-normal text-[#e3e3e3] flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#8ab4f8]" />
            Scan a QR code
          </DialogTitle>

          <div className="flex items-center gap-1">
            {torchAvailable && (
              <button
                type="button"
                onClick={toggleTorch}
                className="p-2 rounded-full text-[#8e918f] hover:text-[#e3e3e3] hover:bg-[#282a2c] transition-colors"
                title={torchOn ? "Turn off torch" : "Turn on torch"}
              >
                {torchOn ? (
                  <FlashlightOff className="h-4 w-4 text-[#fdd663]" />
                ) : (
                  <Flashlight className="h-4 w-4" />
                )}
              </button>
            )}

            <label
              htmlFor="qr-file-upload"
              className="p-2 rounded-full text-[#8e918f] hover:text-[#e3e3e3] hover:bg-[#282a2c] transition-colors cursor-pointer"
              title="Upload QR image"
            >
              <Upload className="h-4 w-4" />
              <input
                id="qr-file-upload"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </DialogHeader>

        {scannedDetails ? (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-[#143220] text-[#81c995] flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h4 className="text-base font-medium text-[#e3e3e3] truncate">
                  {scannedDetails.issuer || scannedDetails.account}
                </h4>
                <p className="text-xs text-[#8e918f] truncate mt-0.5">
                  {scannedDetails.account}
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-[#282a2c] p-3.5 space-y-2 border border-[#3c4043] text-xs">
              <div className="flex items-center justify-between text-[#c4c7c5]">
                <span>Issuer</span>
                <span className="font-medium text-[#e3e3e3]">
                  {scannedDetails.issuer || "None"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[#c4c7c5]">
                <span>Algorithm</span>
                <span className="font-mono text-[#8ab4f8]">
                  {scannedDetails.algorithm}
                </span>
              </div>
              <div className="flex items-center justify-between text-[#c4c7c5]">
                <span>Digits / Interval</span>
                <span className="font-mono text-[#e3e3e3]">
                  {scannedDetails.digits} digits • {scannedDetails.period}s
                </span>
              </div>
            </div>

            {devices.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#c4c7c5] flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-[#8ab4f8]" />
                  Backup to ESP32 Hardware Authenticator
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#282a2c] text-[#e3e3e3] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-xs appearance-none cursor-pointer"
                >
                  <option value="none">Local only (do not sync to hardware)</option>
                  {devices
                    .filter((d) => d.active && !d.revoked_at)
                    .map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name} ({device.api_key_prefix}...)
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDetectedUri(null);
                  setScannedDetails(null);
                  startCamera();
                }}
                className="h-10 px-5 rounded-full text-xs font-medium text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors"
              >
                Scan Another
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={processing}
                className="h-10 px-6 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-xs font-medium transition-all shadow disabled:opacity-50 flex items-center gap-2"
              >
                {processing && <ShieldCheck className="h-4 w-4 animate-spin" />}
                Add Account
              </button>
            </div>
          </div>
        ) : (
          <div className="relative aspect-square w-full bg-[#131314] flex items-center justify-center overflow-hidden">
            {hasCamera ? (
              <>
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                <div className="absolute inset-0 bg-black/40 pointer-events-none flex items-center justify-center">
                  <div className="relative w-64 h-64 border-2 border-transparent">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#8ab4f8] rounded-tl-xl" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#8ab4f8] rounded-tr-xl" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#8ab4f8] rounded-bl-xl" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#8ab4f8] rounded-br-xl" />

                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[#8ab4f8] to-transparent animate-pulse shadow-[0_0_8px_#8ab4f8]" />
                  </div>
                </div>

                <div className="absolute bottom-4 left-0 right-0 text-center px-4">
                  <p className="text-xs text-[#e3e3e3] bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-full inline-block">
                    Place barcode inside the square
                  </p>
                </div>
              </>
            ) : (
              <div className="p-8 text-center space-y-4 max-w-xs">
                <div className="h-12 w-12 rounded-full bg-[#3c1414] text-[#f28b82] mx-auto flex items-center justify-center">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-[#e3e3e3]">
                    Camera unavailable
                  </h4>
                  <p className="text-xs text-[#8e918f] mt-1">
                    {cameraError || "Please check browser permissions"}
                  </p>
                </div>
                <label
                  htmlFor="qr-file-upload-alt"
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-xs font-medium cursor-pointer transition-all shadow"
                >
                  <Upload className="h-4 w-4" />
                  Upload QR Image
                  <input
                    id="qr-file-upload-alt"
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

