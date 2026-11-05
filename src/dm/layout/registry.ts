import {
  LibraryBig,
  Layers,
  Map as MapIcon,
  MonitorPlay,
  SlidersHorizontal,
  Swords,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { InitiativePanel, InitiativeRound } from '../../panels/InitiativePanel'
import { LayersPanel } from '../../panels/LayersPanel'
import { LibraryPanel } from '../../panels/LibraryPanel'
import { PlayerViewPanel, PlayerViewStatus } from '../../panels/PlayerViewPanel'
import { PropertiesPanel, ScenePanel } from '../../panels/PropertiesPanel'
import type { Icon } from '../../ui/controls'
import type { PanelId } from './panelLayout'

export interface PanelDefinition {
  title: string
  icon: Icon
  /** The panel's content; the frame draws the heading. */
  Body: ComponentType
  /** Shown in the header next to the title (status, round...). */
  Extra?: ComponentType
}

/** The DM's side panels, in their docked order (PANEL_IDS). */
export const PANELS: Record<PanelId, PanelDefinition> = {
  'player-view': {
    title: 'Player view',
    icon: MonitorPlay,
    Body: PlayerViewPanel,
    Extra: PlayerViewStatus,
  },
  initiative: { title: 'Initiative', icon: Swords, Body: InitiativePanel, Extra: InitiativeRound },
  library: { title: 'Library', icon: LibraryBig, Body: LibraryPanel },
  layers: { title: 'Layers', icon: Layers, Body: LayersPanel },
  properties: { title: 'Properties', icon: SlidersHorizontal, Body: PropertiesPanel },
  scene: { title: 'Scene', icon: MapIcon, Body: ScenePanel },
}
