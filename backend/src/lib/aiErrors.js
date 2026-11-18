function aiError(error) {
  if (error?.name === 'Error' && ['QUEUE_FULL','VALIDATION_FAILED','WORKER_RESTARTED','WORKER_UNAVAILABLE','WORKER_VERSION','INVALID_INPUT','IDEMPOTENCY_CONFLICT','JOB_WAIT_LIMIT','MEMORY_LIMIT','WALL_TIME_LIMIT','CHILD_EXIT','PROCESS_ERROR','COMPUTATION_ERROR','QUEUE_TIMEOUT','CANCELLED','WORKER_FAILED'].includes(error.code)) return {code:error.code,message:error.message};
  const status = error?.response?.status;
  if (status === 503) return { code: 'AI_BUSY_OR_UNAVAILABLE', message: 'AI ยังไม่พร้อมหรือกำลังประมวลผลงานอื่น กรุณารอให้งานเดิมเสร็จแล้วลองใหม่ (503)' };
  if ([502, 504].includes(status)) return { code: 'AI_GATEWAY_ERROR', message: `การเชื่อมต่อกับ AI ขัดข้อง (${status}) กรุณาตรวจ log ของ AI service ไม่ใช่ผลว่าจัดตารางไม่ได้` };
  if (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code)) return { code: 'AI_REQUEST_TIMEOUT', message: 'หมดเวลารอคำตอบจาก AI งานเดิมอาจยังประมวลผลอยู่ กรุณารอก่อนส่งงานใหม่' };
  return { code: 'AI_REQUEST_FAILED', message: typeof error?.response?.data?.detail === 'string'
    ? error.response.data.detail : 'AI ประมวลผลไม่สำเร็จ กรุณาตรวจ log ของ AI service' };
}
module.exports = { aiError };
