# Disposition of all 17 reported issues

| # | Audit conclusion | Fix IDs |
|---|---|---|
| 1 | Confirmed titlebar logo at left edge; hero brand padding is different and already present. | R06 |
| 2 | Home File menu includes document commands; capability metadata disagrees with toolbar. Actions were not executed. | R05 |
| 3 | Confirmed blank tab-row space with no documents. Keep document tabs when documents actually exist. | R07 |
| 4 | Confirmed shifting metadata/action columns. | R08 |
| 5 | Confirmed irrelevant commands and real right overflow/horizontal menu scrolling. | R03, R05 |
| 6 | Arcs are visibly too faint. Pause label is already improved. Motion timing/global scope needs explicit implementation verification. | R10 |
| 7 | Remove Explore and sample copy from production as requested. Also address sample MRU pollution. | R09 |
| 8 | Remove document tool search from Home. General application settings/help remain available through the menu. | R05 |
| 9 | Remove Home save controls; active Home must not inherit a background document. | R05 |
| 10 | Confirmed arrowed/native scrollbar styling mismatch with modern surfaces. | R11 |
| 11 | Confirmed differing panel scroll/footer bounds. | R11 |
| 12 | Confirmed More = stage overflow while Tools = global palette; improve intent labels and routes. | R13 |
| 13 | Partly already corrected in the dedicated Add chooser. Global palette pin entry and persisted unsupported pins still need consistent eligibility. | R14 |
| 14 | Confirmed dense suspect list and weak hierarchy on 3708-entry noisy fixture. Accuracy and correction backend are not judged. | R18, R19 |
| 15 | Confirmed unrelated empty CropBox inspector in default Edit and after closing suspects. | R17 |
| 16 | Annotation list versus selection inspector already differ correctly. Document summaries still repeat on both sides. | R20 |
| 17 | Confirmed tiny CTA typography and dark icon; white text itself is present. Fix icon contrast, sizing and footer location. | R21 |

Additional findings: R01 compact inspector blocked; R02 export draft lost; R04 navigator/canvas state desynchronization; R12 enabled dock/footer fade; R15 dock width; R16 stage-specific compact context; R22 misleading validation; R23 faint outline badges; R24 visible-range ambiguity; R25 Book View discontinuity; R26 type hierarchy.
