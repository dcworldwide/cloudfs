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
  gap: ${({ theme }) => theme.space.md}px;
  min-height: 48px;
  padding: 8px ${({ theme }) => theme.space.md}px 4px;
  background: transparent;
`;

export const Brand = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
`;

export const Wordmark = styled.span`
  font-weight: 590;
  font-size: 13px;
  letter-spacing: -0.01em;
  line-height: 1;
`;

export const Version = styled.span`
  font-size: 11px;
  font-weight: 450;
  letter-spacing: 0;
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1px;
  margin: 8px;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.color.border};
  overflow: hidden;
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
  background: ${({ theme }) => theme.color.surface};
  overflow: hidden;
`;

export const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm}px;
  align-items: center;
  margin-left: auto;
  flex: none;
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
