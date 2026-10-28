# Anatomia real (ossos, músculos e órgãos)

Os arquivos `public/models/anatomy-<corpo>-<camada>.bin` trazem a anatomia de
verdade usada na **Anatomia 3D** (visão de músculos e visão interna) e no
**Atlas de Acupuntura** (camadas músculos / esqueleto / órgãos e agulha):

| camada    | conteúdo                                             |
|-----------|------------------------------------------------------|
| `bones`   | ossos, dentes, cartilagens costais e discos          |
| `muscles` | ~440 músculos, tendões e fáscias (com a parte tendínea marcada) |
| `organs`  | órgãos (Zang-Fu) e grandes vasos                     |

A fonte é o **BodyParts3D** (Database Center for Life Science, Japão), feito a
partir de exames de um corpo humano real. Cada peça é encaixada no corpo
feminino e no masculino (MakeHuman, ver `tools/bodies`).

## Licença

BodyParts3D, © The Database Center for Life Science — **CC BY-SA 2.1 Japan**.
Uso comercial permitido com atribuição; os arquivos gerados (`anatomy-*.bin`)
são obras derivadas e ficam sob a mesma licença. O crédito aparece no canto do
visualizador sempre que a anatomia real está na tela.

## Gerar

Requer Python 3 com `numpy`, `scipy` e `fast-simplification`:

```
pip install numpy scipy fast-simplification
python tools/anatomy/build_anatomy.py C:\bp3d            # baixa (1ª vez, ~1,1 GB) e gera os dois corpos
python tools/anatomy/build_anatomy.py C:\bp3d female     # só um
```

A pasta (`C:\bp3d`) guarda os STL baixados e um cache das malhas simplificadas;
fica fora do repositório. Leva ~1 min por corpo depois do primeiro download.

## O que o gerador faz

- **Catálogo** (`catalog.py`): quais peças entram, em que camada, o tecido
  (cor/material), o nome em português com o lado ("Bíceps braquial direito
  (cabeça longa)"), a chave do músculo em `public/js/muscle-data.js` (clique,
  destaque e condições) e o meridiano de cada órgão (Zang-Fu).
- **Simplificação**: ~150 mil triângulos de ossos, ~260 mil de músculos e
  ~60 mil de órgãos por corpo (`BUDGET`), divididos pela área de cada peça.
- **Encaixe** (o BodyParts3D é um homem de braços caídos e palmas para a
  frente; os corpos de destino estão em "A"):
  - ossos dos membros: transformação rígida + escala de junta a junta
    (cabeça do fêmur, joelho, tornozelo, ombro, cotovelo, punho, cabeças dos
    metacarpos/metatarsos, falanges); o rádio gira em volta da ulna
    (pronação) para a palma ficar como a do corpo;
  - tronco, pescoço e cabeça: fatia a fatia — altura por marcos (quadril,
    ombro, olhos, topo da cabeça) e largura/profundidade pela razão entre as
    peles dos dois corpos em cada altura;
  - músculos: cada vértice segue os ossos mais próximos (pesos suaves); perto
    do ombro, quem está no "cilindro" do braço segue o braço; nos membros a
    espessura é corrigida pela razão entre as peles naquele ponto;
  - por fim, nada fica fora da pele do corpo de destino.
- **Oclusão ambiente** e **tendão** "assados" por vértice (sombras de contato
  entre as peças; onde o músculo afina vira tendão branco-perolado).

## Formato do `.bin`

gzip de: `u32` tamanho do cabeçalho · cabeçalho JSON (UTF-8, completado com
espaços até múltiplo de 4) · bloco binário. Cada peça do cabeçalho aponta para
posições `u16×3` (quantizadas na caixa da peça), oclusão `u8`, tendão `u8`
(músculos) e índices `u16`/`u32`. O servidor entrega com
`Content-Encoding: gzip`; a leitura está em `public/js/anatomy-real.js`.
