"""Tests for project module — .cproject XML parsing."""

import tempfile
from pathlib import Path

from e2studio_mcp.project import parse_cproject, list_projects


SAMPLE_CPROJECT = """\
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?fileVersion 4.0.0?><cproject storage_type_id="org.eclipse.cdt.core.XmlProjectDescriptionStorage">
    <storageModule moduleId="org.eclipse.cdt.core.settings">
        <cconfiguration id="test.config.1">
            <storageModule buildSystemId="org.eclipse.cdt.managedbuilder.core.configurationDataProvider" id="test.config.1" moduleId="org.eclipse.cdt.core.settings" name="HardwareDebug">
                <externalSettings/>
                <extensions/>
            </storageModule>
            <storageModule moduleId="com.renesas.cdt.managedbuild.core.toolchainInfo">
                <option id="toolchain.id" value="Renesas_RXC"/>
                <option id="toolchain.version" value="v3.07.00"/>
            </storageModule>
            <storageModule moduleId="cdtBuildSystem" version="4.0.0">
                <configuration artifactExtension="mot" artifactName="${ProjName}" name="HardwareDebug">
                    <folderInfo id="test.1." name="/" resourcePath="">
                        <toolChain id="test.tc.1" name="Renesas CCRX Toolchain">
                            <tool id="test.common" name="Common">
                                <option superClass="com.renesas.cdt.managedbuild.renesas.ccrx.common.option.deviceCommand" value="R5F5651E" valueType="string"/>
                                <option superClass="com.renesas.cdt.managedbuild.renesas.ccrx.common.option.deviceFamily" value="RX651" valueType="string"/>
                                <option superClass="com.renesas.cdt.managedbuild.renesas.ccrx.common.option.isa" value="com.renesas.cdt.managedbuild.renesas.ccrx.common.option.isa.rxv2" valueType="enumerated"/>
                                <option superClass="com.renesas.cdt.managedbuild.renesas.ccrx.common.option.hasFpu" value="TRUE" valueType="string"/>
                            </tool>
                            <tool id="test.dsp" name="DSP Assembler">
                                <option superClass="com.renesas.cdt.managedbuild.renesas.ccrx.dsp.option.endian" value="com.renesas.cdt.managedbuild.renesas.ccrx.dsp.option.endian.big" valueType="enumerated"/>
                            </tool>
                            <tool id="test.compiler" name="Compiler">
                                <option superClass="com.renesas.cdt.managedbuild.renesas.ccrx.compiler.option.include" valueType="includePath">
                                    <listOptionValue builtIn="false" value="${TCINSTALL}/include"/>
                                    <listOptionValue builtIn="false" value="src"/>
                                </option>
                                <option superClass="com.renesas.cdt.managedbuild.renesas.ccrx.compiler.option.define" valueType="definedSymbols">
                                    <listOptionValue builtIn="false" value="DEBUG"/>
                                    <listOptionValue builtIn="false" value="RTOS_ENABLED"/>
                                </option>
                            </tool>
                        </toolChain>
                    </folderInfo>
                </configuration>
            </storageModule>
        </cconfiguration>
    </storageModule>
</cproject>
"""


def test_parse_cproject():
    with tempfile.TemporaryDirectory() as tmpdir:
        proj_dir = Path(tmpdir) / "test-project"
        proj_dir.mkdir()
        cproject = proj_dir / ".cproject"
        cproject.write_text(SAMPLE_CPROJECT, encoding="utf-8")

        cfg = parse_cproject(cproject)
        assert cfg.device == "R5F5651E"
        assert cfg.device_family == "RX651"
        assert cfg.toolchain_id == "Renesas_RXC"
        assert cfg.toolchain_version == "v3.07.00"
        assert cfg.isa == "RXv2"
        assert cfg.has_fpu is True
        assert cfg.endian == "big"
        assert cfg.build_config == "HardwareDebug"
        assert cfg.artifact_extension == "mot"
        assert len(cfg.include_paths) == 2
        assert len(cfg.defines) == 2
        assert "DEBUG" in cfg.defines


def test_list_projects():
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create a fake project
        proj_dir = Path(tmpdir) / "proj1"
        proj_dir.mkdir()
        (proj_dir / ".cproject").write_text(SAMPLE_CPROJECT, encoding="utf-8")

        # Create a non-project directory
        (Path(tmpdir) / "not-a-project").mkdir()

        projects = list_projects(Path(tmpdir))
        assert len(projects) == 1
        assert projects[0]["name"] == "proj1"
        assert projects[0]["device"] == "R5F5651E"
