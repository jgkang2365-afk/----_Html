-- MES 수동 동기화 요청 큐
-- 웹 서버는 이 테이블에 pending 신호만 남기고, 사내 Windows PC 데몬이 실제 MES 자동화를 수행합니다.

CREATE TABLE IF NOT EXISTS public.mes_sync_queue (
    id BIGINT PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'idle',
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mes_sync_queue_status_check CHECK (status IN ('idle', 'pending', 'running', 'success', 'error'))
);

INSERT INTO public.mes_sync_queue (id, status)
VALUES (1, 'idle')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.mes_sync_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'mes_sync_queue'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.mes_sync_queue;
    END IF;
END $$;

COMMENT ON TABLE public.mes_sync_queue IS 'MES 수동 동기화 요청 상태 큐';
COMMENT ON COLUMN public.mes_sync_queue.status IS 'idle, pending, running, success, error';
COMMENT ON COLUMN public.mes_sync_queue.error_message IS '데몬 또는 매크로 실행 실패 상세 메시지';
