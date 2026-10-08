import styled from "@emotion/styled";

export const AppShell = styled.div`
  height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  font-family: ${({ theme }) => theme.font};
`;

export const TopBar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: ${({ theme }) => theme.space.md}px ${({ theme }) => theme.space.xl}px;
  background: transparent;
`;

export const Brand = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
`;

export const Wordmark = styled.span`
  font-family: Outfit, ${({ theme }) => theme.font};
  font-weight: 600;
  font-size: 26px;
  letter-spacing: -0.045em;
  line-height: 1;
`;

export const Version = styled.span`
  font-family: ${({ theme }) => theme.mono};
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.color.muted};
  font-variant-numeric: tabular-nums;
`;

export const Main = styled.main`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

export const Panes = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }
`;

export const Pane = styled.section`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: ${({ theme }) => theme.space.sm}px;
  border-radius: 18px;
  background: ${({ theme }) => (theme.mode === "light" ? "rgba(255,255,255,0.42)" : "rgba(16,20,34,0.38)")};
  border: 1px solid ${({ theme }) => (theme.mode === "light" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.1)")};
  box-shadow: ${({ theme }) =>
    theme.mode === "light" ? "0 10px 30px rgba(40, 50, 80, 0.06)" : "0 12px 32px rgba(0, 0, 0, 0.22)"};
  backdrop-filter: blur(22px) saturate(1.4);
  overflow: hidden;
`;

export const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm}px;
  align-items: center;
`;

export const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.md}px;
`;

export const Muted = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.color.muted};
  font-size: 13px;
  line-height: 1.5;
`;

export const PathText = styled.code`
  font-family: ${({ theme }) => theme.mono};
  font-size: 12px;
  color: ${({ theme }) => theme.color.text};
  word-break: break-all;
`;
